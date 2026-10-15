# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from app.models.feature_policy import FeaturePolicy, PORTAL_FEATURE_FIELDS

import json
import logging
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import (
    PortalAccountRole,
    PortalAdminRequest,
    PortalAdminRequestMessage,
    S3Account,
    User,
    UserNotification,
    UserRole,
)
from app.models.portal_requests import (
    PortalAccountQuotaChangeRequestCreate,
    PortalAdminRequestCreate,
    PortalAdminRequestMessageOut,
    PortalAdminRequestOut,
    PortalAdminRequestType,
    PortalSettingChangeRequestCreate,
    PortalUserAccessRequestCreate,
    PortalUserRemovalRequestCreate,
)
from app.models.access_context import AccountAccess
from app.models.app_settings import PortalSettingsOverride
from app.models.s3_account import S3AccountUpdate
from app.core.sensitive_data import sanitize_error_detail
from app.services.audit_service import AuditService
from app.services.portal_collaborator_requests_service import PortalCollaboratorRequestsService
from app.services.s3_accounts_service import S3AccountsService, get_s3_accounts_service
from app.services.portal_service import PortalService
from app.services.users_service import UsersService, get_users_service
from app.utils.size_units import size_to_bytes
from app.utils.time import utcnow


REQUEST_FINAL_STATUSES = {"approved", "rejected", "failed"}
ADMIN_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}
logger = logging.getLogger(__name__)

PORTAL_DIRECT_SETTING_KEYS = {
    "browser_access_enabled",
    "allow_private_storage_space_create",
    "allow_portal_named_bucket_create",
    "allow_portal_user_access_key_create",
    "allow_portal_user_external_sharing",
    "server_access_logging_enabled",
    "storage_space_version_cleanup_enabled",
}
PORTAL_BUCKET_SETTING_KEYS = {
    "bucket_defaults.versioning": "versioning",
    "bucket_defaults.enable_lifecycle": "enable_lifecycle",
    "bucket_defaults.enable_cors": "enable_cors",
    "bucket_defaults.noncurrent_version_expiration_days": "noncurrent_version_expiration_days",
    "bucket_defaults.cors_allowed_origins": "cors_allowed_origins",
}


class PortalRequestNotFound(ValueError):
    pass


class PortalRequestConflict(RuntimeError):
    pass


class PortalRequestExecutionError(RuntimeError):
    pass


class PortalRequestsService:
    def __init__(
        self,
        db: Session,
        *,
        users_service: Optional[UsersService] = None,
        accounts_service: Optional[S3AccountsService] = None,
    ) -> None:
        self.db = db
        self.users_service = users_service or get_users_service(db)
        self.accounts_service = accounts_service or get_s3_accounts_service(db)
        self.collaborator_requests = PortalCollaboratorRequestsService(
            db,
            users_service=self.users_service,
        )

    def create_request(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalAdminRequestCreate,
    ) -> PortalAdminRequestOut:
        if isinstance(payload, PortalUserAccessRequestCreate):
            request_type, payload_data = self.collaborator_requests.normalize_user_access_request(
                actor,
                access,
                payload,
            )
        else:
            request_type, payload_data = self._normalize_create_payload(payload)
        if isinstance(payload, PortalAccountQuotaChangeRequestCreate):
            self._validate_quota_request_against_current_usage(actor, access, payload)
        if isinstance(payload, PortalSettingChangeRequestCreate):
            if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
                raise ValueError("Portal manager rights required for project setting requests")
            if access.account.portal_settings_delegated:
                raise ValueError("Portal settings are already delegated to Portal managers")
            feature = PORTAL_FEATURE_FIELDS.get(payload.setting)
            if feature and payload.mode != "inherit" and payload.value is True:
                policy = PortalService(self.db).get_effective_portal_settings(access.account).feature_policies
                if getattr(policy, feature) == FeaturePolicy.DISABLED:
                    raise ValueError("This feature is disabled by the platform")
        row = PortalAdminRequest(
            account_id=int(access.account.id),
            requester_user_id=int(actor.id),
            requester_email=actor.email,
            request_type=request_type,
            status="pending",
            payload_json=self._encode_json(payload_data),
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        delegated_execution = self.collaborator_requests.is_delegated_execution(
            access,
            request_type=request_type,
            payload_data=payload_data,
        )
        AuditService(self.db).record_action(
            user=actor,
            scope="portal",
            action="create_portal_request",
            entity_type="portal_request",
            entity_id=str(row.id),
            account=row.account,
            metadata={
                "request_type": request_type,
                "intent": payload_data.get("intent"),
                "execution": "delegated" if delegated_execution else "admin_approval",
            },
        )
        if delegated_execution:
            return self._execute_delegated_request(row, actor)
        self._notify_admins(row)
        self.db.commit()
        return self.to_out(row)

    def _execute_delegated_request(
        self,
        row: PortalAdminRequest,
        actor: User,
    ) -> PortalAdminRequestOut:
        try:
            result = self._execute_request(row)
        except Exception as exc:
            detail = sanitize_error_detail(str(exc))
            self.db.rollback()
            failed = self._finalize_failed_request(int(row.id), actor, detail)
            AuditService(self.db).record_action(
                user=actor,
                scope="portal",
                action="execute_delegated_portal_request",
                entity_type="portal_request",
                entity_id=str(failed.id),
                account=failed.account,
                metadata={
                    "request_type": failed.request_type,
                    "execution": "delegated",
                    "error": detail,
                },
                status="failure",
                message=detail,
            )
            raise PortalRequestExecutionError(detail) from exc

        approved = self._finalize_approved_request(int(row.id), actor, result)
        AuditService(self.db).record_action(
            user=actor,
            scope="portal",
            action="execute_delegated_portal_request",
            entity_type="portal_request",
            entity_id=str(approved.id),
            account=approved.account,
            metadata={
                "request_type": approved.request_type,
                "execution": "delegated",
                "result": result,
            },
        )
        return self.to_out(approved)

    def list_for_portal_user(
        self,
        actor: User,
        access: AccountAccess,
        *,
        status: Optional[str] = None,
    ) -> list[PortalAdminRequestOut]:
        query = self.db.query(PortalAdminRequest).filter(
            PortalAdminRequest.account_id == int(access.account.id),
            PortalAdminRequest.requester_user_id == int(actor.id),
        )
        if status:
            query = query.filter(PortalAdminRequest.status == status)
        rows = query.order_by(PortalAdminRequest.created_at.desc(), PortalAdminRequest.id.desc()).all()
        return [self.to_out(row) for row in rows]

    def list_for_admin(
        self,
        *,
        status: Optional[str] = None,
        request_type: Optional[PortalAdminRequestType] = None,
        account_id: Optional[int] = None,
        search: Optional[str] = None,
        limit: int = 200,
    ) -> list[PortalAdminRequestOut]:
        query = self.db.query(PortalAdminRequest)
        if status:
            query = query.filter(PortalAdminRequest.status == status)
        if request_type:
            query = query.filter(PortalAdminRequest.request_type == request_type)
        if account_id is not None:
            query = query.filter(PortalAdminRequest.account_id == int(account_id))
        if search:
            trimmed = search.strip()
            if trimmed:
                pattern = f"%{trimmed}%"
                query = query.outerjoin(S3Account, PortalAdminRequest.account_id == S3Account.id).filter(
                    or_(
                        PortalAdminRequest.requester_email.ilike(pattern),
                        PortalAdminRequest.payload_json.ilike(pattern),
                        S3Account.name.ilike(pattern),
                    )
                )
        rows = (
            query.order_by(PortalAdminRequest.created_at.desc(), PortalAdminRequest.id.desc())
            .limit(max(1, min(int(limit), 500)))
            .all()
        )
        return [self.to_out(row) for row in rows]

    def add_admin_message(
        self,
        request_id: int,
        actor: User,
        message: str,
    ) -> PortalAdminRequestOut:
        row = self._load_request(request_id)
        self._add_message(row, actor, message)
        row.updated_at = utcnow()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        self._notify_requester(
            row,
            title="Message on your Portal request",
            message=f"{actor.email} replied to your Portal request.",
            event_suffix=f"message:{row.messages[-1].id if row.messages else 'latest'}",
        )
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action="message_portal_request",
            entity_type="portal_request",
            entity_id=str(row.id),
            account=row.account,
            metadata={"request_type": row.request_type},
        )
        return self.to_out(row)

    def reject_request(
        self,
        request_id: int,
        actor: User,
        *,
        message: Optional[str] = None,
    ) -> PortalAdminRequestOut:
        row = self._load_request(request_id)
        self._ensure_pending(row)
        now = utcnow()
        row.status = "rejected"
        row.decided_by_user_id = int(actor.id)
        row.decided_by_email = actor.email
        row.decided_at = now
        row.updated_at = now
        if message:
            self._add_message(row, actor, message)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        self._notify_requester(
            row,
            title="Portal request rejected",
            message="Your Portal request was rejected by a storage admin.",
            event_suffix="rejected",
        )
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action="reject_portal_request",
            entity_type="portal_request",
            entity_id=str(row.id),
            account=row.account,
            metadata={"request_type": row.request_type},
        )
        return self.to_out(row)

    def approve_request(
        self,
        request_id: int,
        actor: User,
        *,
        message: Optional[str] = None,
    ) -> PortalAdminRequestOut:
        row = self._load_request(request_id)
        self._ensure_pending(row)
        row.status = "processing"
        row.updated_at = utcnow()
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)

        try:
            result = self._execute_request(row)
        except Exception as exc:
            detail = sanitize_error_detail(str(exc))
            self.db.rollback()
            failed = self._finalize_failed_request(request_id, actor, detail)
            self._notify_requester(
                failed,
                title="Portal request failed",
                message="Your Portal request could not be completed after approval.",
                event_suffix="failed",
            )
            self.db.commit()
            AuditService(self.db).record_action(
                user=actor,
                scope="admin",
                action="approve_portal_request",
                entity_type="portal_request",
                entity_id=str(failed.id),
                account=failed.account,
                metadata={"request_type": failed.request_type, "error": detail},
                status="failure",
                message=detail,
            )
            raise PortalRequestExecutionError(detail) from exc

        approved = self._finalize_approved_request(
            request_id,
            actor,
            result,
            message=message,
        )
        self._notify_requester(
            approved,
            title="Portal request approved",
            message="Your Portal request was approved and applied.",
            event_suffix="approved",
        )
        self.db.commit()
        AuditService(self.db).record_action(
            user=actor,
            scope="admin",
            action="approve_portal_request",
            entity_type="portal_request",
            entity_id=str(approved.id),
            account=approved.account,
            metadata={"request_type": approved.request_type, "result": result},
        )
        return self.to_out(approved)

    def _finalize_failed_request(
        self,
        request_id: int,
        actor: User,
        detail: str,
    ) -> PortalAdminRequest:
        row = self._load_request(request_id)
        now = utcnow()
        row.status = "failed"
        row.error_message = detail
        row.decided_by_user_id = int(actor.id)
        row.decided_by_email = actor.email
        row.decided_at = now
        row.updated_at = now
        self.db.add(row)
        self.db.commit()
        return row

    def _finalize_approved_request(
        self,
        request_id: int,
        actor: User,
        result: dict[str, Any],
        *,
        message: Optional[str] = None,
    ) -> PortalAdminRequest:
        row = self._load_request(request_id)
        now = utcnow()
        row.status = "approved"
        row.result_json = self._encode_json(result)
        row.error_message = None
        row.decided_by_user_id = int(actor.id)
        row.decided_by_email = actor.email
        row.decided_at = now
        row.updated_at = now
        if message:
            self._add_message(row, actor, message)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def to_out(self, row: PortalAdminRequest) -> PortalAdminRequestOut:
        return PortalAdminRequestOut(
            id=int(row.id),
            account_id=int(row.account_id),
            account_name=row.account.name if row.account else None,
            request_type=row.request_type,
            status=row.status,
            payload=self._decode_json(row.payload_json),
            result=self._decode_json(row.result_json) if row.result_json else None,
            error_message=row.error_message,
            requester_user_id=row.requester_user_id,
            requester_email=row.requester_email,
            decided_by_user_id=row.decided_by_user_id,
            decided_by_email=row.decided_by_email,
            decided_at=row.decided_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
            messages=[
                PortalAdminRequestMessageOut(
                    id=int(message.id),
                    author_user_id=message.author_user_id,
                    author_email=message.author_email,
                    author_role=message.author_role,
                    message=message.message,
                    created_at=message.created_at,
                )
                for message in row.messages
            ],
        )

    def _execute_request(self, row: PortalAdminRequest) -> dict[str, Any]:
        if row.request_type == "portal_user_access":
            return self.collaborator_requests.execute_user_access(
                row,
                self._decode_json(row.payload_json),
            )
        if row.request_type == "portal_user_removal":
            return self.collaborator_requests.execute_user_removal(
                row,
                self._decode_json(row.payload_json),
            )
        if row.request_type == "account_quota_change":
            return self._execute_quota_change(row)
        if row.request_type == "portal_setting_change":
            return self._execute_setting_change(row)
        raise ValueError("Unsupported Portal request type")

    def _execute_quota_change(self, row: PortalAdminRequest) -> dict[str, Any]:
        payload = PortalAccountQuotaChangeRequestCreate.model_validate(
            {
                "request_type": "account_quota_change",
                **self._decode_json(row.payload_json),
            },
            strict=True,
        )
        direction = payload.direction
        target_value = payload.target_quota_value
        target_unit = payload.target_quota_unit
        target_bytes = size_to_bytes(target_value, target_unit)
        current_size_gb, current_objects = self.accounts_service.get_account_quota(row.account)
        current_bytes = size_to_bytes(current_size_gb, "GiB") if current_size_gb is not None else None
        if current_bytes is not None and target_bytes is not None:
            if direction == "increase" and target_bytes <= current_bytes:
                raise ValueError("Requested quota must be greater than the current quota")
            if direction == "decrease" and target_bytes >= current_bytes:
                raise ValueError("Requested quota must be lower than the current quota")
        self.accounts_service.update_account(
            int(row.account_id),
            S3AccountUpdate(
                quota_max_size_gb=target_value,
                quota_max_size_unit=target_unit,
                quota_max_objects=current_objects,
            ),
        )
        return {
            "previous_quota_size_gb": current_size_gb,
            "previous_quota_objects": current_objects,
            "target_quota_value": target_value,
            "target_quota_unit": target_unit,
            "target_quota_bytes": target_bytes,
        }

    def _execute_setting_change(self, row: PortalAdminRequest) -> dict[str, Any]:
        payload = PortalSettingChangeRequestCreate.model_validate(
            {
                "request_type": "portal_setting_change",
                **self._decode_json(row.payload_json),
            },
            strict=True,
        )
        portal_service = PortalService(self.db)
        account_settings = portal_service.get_portal_account_settings(row.account)
        feature = PORTAL_FEATURE_FIELDS.get(payload.setting)
        if (feature and payload.mode != "inherit" and payload.value is True
                and getattr(account_settings.effective.feature_policies, feature) == FeaturePolicy.DISABLED):
            raise ValueError("This feature is disabled by the platform")
        override_payload = account_settings.admin_override.model_dump(
            mode="json",
            exclude_unset=True,
            exclude_none=True,
        )

        if payload.setting in PORTAL_DIRECT_SETTING_KEYS:
            if payload.mode == "inherit":
                override_payload.pop(payload.setting, None)
            else:
                override_payload[payload.setting] = payload.value
        else:
            nested_key = PORTAL_BUCKET_SETTING_KEYS.get(payload.setting)
            if nested_key is None:
                raise ValueError("Unsupported Portal setting")
            bucket_defaults = dict(override_payload.get("bucket_defaults") or {})
            if payload.mode == "inherit":
                bucket_defaults.pop(nested_key, None)
            else:
                bucket_defaults[nested_key] = payload.value
            if bucket_defaults:
                override_payload["bucket_defaults"] = bucket_defaults
            else:
                override_payload.pop("bucket_defaults", None)

        updated = portal_service.update_admin_portal_settings_override(
            row.account,
            PortalSettingsOverride.model_validate(override_payload, strict=True),
        )
        effective_payload = updated.effective.model_dump(mode="json")
        if payload.setting in PORTAL_DIRECT_SETTING_KEYS:
            effective_value = effective_payload[payload.setting]
        else:
            effective_value = effective_payload["bucket_defaults"][
                PORTAL_BUCKET_SETTING_KEYS[payload.setting]
            ]
        return {
            "setting": payload.setting,
            "mode": payload.mode,
            "requested_value": payload.value,
            "effective_value": effective_value,
        }

    def _validate_quota_request_against_current_usage(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalAccountQuotaChangeRequestCreate,
    ) -> None:
        target_bytes = size_to_bytes(payload.target_quota_value, payload.target_quota_unit)
        if target_bytes is None:
            return
        try:
            usage = PortalService(self.db).get_usage(actor, access)
        except Exception as exc:  # noqa: BLE001 - usage may be unavailable on degraded RGW paths.
            logger.warning("Unable to validate Portal quota request against usage: %s", exc)
            return
        used_bytes = usage.used_bytes
        if used_bytes is not None and target_bytes < int(used_bytes):
            raise ValueError("Requested quota cannot be lower than the space already used")

    def _load_request(self, request_id: int) -> PortalAdminRequest:
        row = self.db.query(PortalAdminRequest).filter(PortalAdminRequest.id == int(request_id)).first()
        if not row:
            raise PortalRequestNotFound("Request not found")
        return row

    def _ensure_pending(self, row: PortalAdminRequest) -> None:
        if row.status != "pending":
            if row.status == "processing":
                raise PortalRequestConflict("Request is already being processed")
            if row.status in REQUEST_FINAL_STATUSES:
                raise PortalRequestConflict("Request has already been decided")
            raise PortalRequestConflict("Request cannot be modified")

    def _add_message(self, row: PortalAdminRequest, actor: User, message: str) -> None:
        clean_message = " ".join(str(message).split())
        if not clean_message:
            return
        row.messages.append(
            PortalAdminRequestMessage(
                request_id=int(row.id),
                author_user_id=int(actor.id),
                author_email=actor.email,
                author_role=actor.role,
                message=clean_message,
                created_at=utcnow(),
            )
        )

    def _notify_admins(self, row: PortalAdminRequest) -> None:
        admins = (
            self.db.query(User)
            .filter(User.is_active.is_(True), User.role.in_(ADMIN_ROLES))
            .all()
        )
        for admin in admins:
            self._add_notification(
                user_id=int(admin.id),
                title="New Portal request",
                message=f"{row.requester_email} submitted a Portal request.",
                event_key=f"portal_request:{row.id}:created:{admin.id}",
                severity="info",
                payload={"request_id": row.id, "request_type": row.request_type, "account_id": row.account_id},
            )

    def _notify_requester(
        self,
        row: PortalAdminRequest,
        *,
        title: str,
        message: str,
        event_suffix: str,
    ) -> None:
        if not row.requester_user_id:
            return
        self._add_notification(
            user_id=int(row.requester_user_id),
            title=title,
            message=message,
            event_key=f"portal_request:{row.id}:{event_suffix}",
            severity="info" if row.status != "failed" else "warning",
            payload={"request_id": row.id, "request_type": row.request_type, "status": row.status},
        )

    def _add_notification(
        self,
        *,
        user_id: int,
        title: str,
        message: str,
        event_key: str,
        severity: str,
        payload: dict[str, Any],
    ) -> None:
        exists = (
            self.db.query(UserNotification.id)
            .filter(UserNotification.user_id == int(user_id), UserNotification.event_key == event_key)
            .first()
        )
        if exists:
            return
        self.db.add(
            UserNotification(
                user_id=int(user_id),
                notification_type="portal_request",
                severity=severity,
                title=title,
                message=message,
                subject_type=None,
                event_key=event_key,
                payload_json=self._encode_json(payload),
                created_at=utcnow(),
            )
        )

    def _normalize_create_payload(self, payload: PortalAdminRequestCreate) -> tuple[str, dict[str, Any]]:
        if isinstance(payload, PortalUserRemovalRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        if isinstance(payload, PortalAccountQuotaChangeRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        if isinstance(payload, PortalSettingChangeRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        raise ValueError("Unsupported Portal request payload")

    @staticmethod
    def _encode_json(payload: dict[str, Any]) -> str:
        return json.dumps(payload, ensure_ascii=True, sort_keys=True)

    @staticmethod
    def _decode_json(raw: str) -> dict[str, Any]:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise ValueError("Portal request JSON must be an object")
        return parsed


def get_portal_requests_service(db: Session) -> PortalRequestsService:
    return PortalRequestsService(db)
