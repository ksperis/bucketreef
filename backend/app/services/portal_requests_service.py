# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from datetime import datetime
from typing import Any, NoReturn, Optional

from sqlalchemy import String, cast, or_, select
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.domain_errors import ResourceConflictError, ResourceNotFoundError
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import PortalAdminRequest, PortalAdminRequestMessage, S3Account, User
from app.core.domain_enums import PortalAccountRole
from app.services.access_context_contracts import AccountAccess
from app.models.app_settings import PortalSettingsOverride
from app.models.feature_policy import FeaturePolicy, PORTAL_FEATURE_FIELDS
from app.models.portal_requests import (
    PortalAccountQuotaChangeRequestCreate,
    PortalAdminRequestCreate,
    PortalAdminRequestListingRequest,
    PortalAdminRequestMessageOut,
    PortalAdminRequestOut,
    PortalAdminRequestType,
    PaginatedPortalAdminRequestsResponse,
    PortalSettingChangeRequestCreate,
    PortalUserAccessRequestCreate,
    PortalUserRemovalRequestCreate,
)
from app.services.audit_service import AuditService
from app.services.portal_collaborator_requests_service import PortalCollaboratorRequestsService
from app.services.portal_request_notification_service import PortalRequestNotificationService
from app.services.portal_service import PortalService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_quota_service import S3AccountQuotaService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.sqlalchemy_pagination import paginate_scalars
from app.utils.size_units import size_to_bytes
from app.utils.time import utcnow


REQUEST_FINAL_STATUSES = {"approved", "rejected", "failed"}

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


class PortalRequestNotFound(ResourceNotFoundError):
    pass


class PortalRequestConflict(ResourceConflictError):
    pass


class PortalRequestExecutionError(RuntimeError):
    pass


class PortalRequestsService:
    def __init__(
        self,
        db: Session,
        *,
        account_metrics: Optional[S3AccountMetricsService] = None,
        account_quota: Optional[S3AccountQuotaService] = None,
        account_repository: Optional[S3AccountRepository] = None,
    ) -> None:
        self.db = db
        self.account_metrics = account_metrics or S3AccountMetricsService()
        self.account_repository = account_repository or S3AccountRepository(db)
        self.account_quota = account_quota or S3AccountQuotaService(
            S3AccountRgwContextService(db)
        )
        self.collaborator_requests = PortalCollaboratorRequestsService(db)

    @staticmethod
    def _apply_request_decision(
        row: PortalAdminRequest,
        *,
        actor_id: int,
        actor_email: str,
        status: str,
        decided_at: datetime,
    ) -> None:
        row.status = status
        row.decided_by_user_id = actor_id
        row.decided_by_email = actor_email
        row.decided_at = decided_at
        row.updated_at = decided_at

    @staticmethod
    def _load_request_from(db: Session, request_id: int) -> PortalAdminRequest:
        row = db.scalar(
            select(PortalAdminRequest).where(PortalAdminRequest.id == int(request_id))
        )
        if not row:
            raise PortalRequestNotFound("Request not found")
        return row

    @staticmethod
    def _append_message(
        row: PortalAdminRequest,
        *,
        author_user_id: int,
        author_email: str,
        author_role: str,
        message: str,
        created_at: datetime,
    ) -> None:
        clean_message = " ".join(str(message).split())
        if not clean_message:
            return
        row.messages.append(
            PortalAdminRequestMessage(
                request_id=int(row.id),
                author_user_id=author_user_id,
                author_email=author_email,
                author_role=author_role,
                message=clean_message,
                created_at=created_at,
            )
        )

    def _notify_admins(self, request_id: int) -> None:
        def persist_once(write_db: Session) -> None:
            row = self._load_request_from(write_db, request_id)
            PortalRequestNotificationService(write_db).notify_admins(row)

        run_replayable_db_unit(self.db, persist_once)

    def _notify_requester(
        self,
        request_id: int,
        *,
        title: str,
        message: str,
        event_suffix: str,
    ) -> None:
        def persist_once(write_db: Session) -> None:
            row = self._load_request_from(write_db, request_id)
            PortalRequestNotificationService(write_db).notify_requester(
                row,
                title=title,
                message=message,
                event_suffix=event_suffix,
            )

        run_replayable_db_unit(self.db, persist_once)

    def create_request(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalAdminRequestCreate,
    ) -> PortalAdminRequestOut:
        request_type, payload_data = self._prepare_create_request(
            actor,
            access,
            payload,
        )
        account_id = int(access.account.id)
        requester_user_id = int(actor.id)
        requester_email = actor.email
        created_at = utcnow()

        def create_once(write_db: Session) -> int:
            row = PortalAdminRequest(
                account_id=account_id,
                requester_user_id=requester_user_id,
                requester_email=requester_email,
                request_type=request_type,
                status="pending",
                payload=dict(payload_data),
                created_at=created_at,
                updated_at=created_at,
            )
            write_db.add(row)
            write_db.flush()
            return int(row.id)

        request_id = run_replayable_db_unit(self.db, create_once)
        row = self._load_request(request_id)
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
        self._notify_admins(request_id)
        return self.to_out(self._load_request(request_id))

    def _prepare_create_request(
        self,
        actor: User,
        access: AccountAccess,
        payload: PortalAdminRequestCreate,
    ) -> tuple[str, dict[str, Any]]:
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
        return request_type, payload_data

    def _execute_delegated_request(
        self,
        row: PortalAdminRequest,
        actor: User,
    ) -> PortalAdminRequestOut:
        try:
            result = self._execute_request(row)
        except Exception as exc:
            self._raise_execution_failure(
                int(row.id),
                actor,
                exc,
                scope="portal",
                action="execute_delegated_portal_request",
                execution="delegated",
            )

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

    def _raise_execution_failure(
        self,
        request_id: int,
        actor: User,
        exc: Exception,
        *,
        scope: str,
        action: str,
        execution: Optional[str] = None,
        notify_requester: bool = False,
    ) -> NoReturn:
        detail = sanitized_error_log_detail(exc)
        self.db.rollback()
        failed = self._finalize_failed_request(request_id, actor, detail)
        if notify_requester:
            self._notify_requester(
                request_id,
                title="Portal request failed",
                message="Your Portal request could not be completed after approval.",
                event_suffix="failed",
            )
            failed = self._load_request(request_id)

        metadata: dict[str, Any] = {"request_type": failed.request_type}
        if execution is not None:
            metadata["execution"] = execution
        metadata["error"] = detail
        AuditService(self.db).record_action(
            user=actor,
            scope=scope,
            action=action,
            entity_type="portal_request",
            entity_id=str(failed.id),
            account=failed.account,
            metadata=metadata,
            status="failure",
            message=detail,
        )
        raise PortalRequestExecutionError(detail) from exc

    def list_for_portal_user(
        self,
        actor: User,
        access: AccountAccess,
        *,
        status: Optional[str] = None,
    ) -> list[PortalAdminRequestOut]:
        stmt = select(PortalAdminRequest).where(
            PortalAdminRequest.account_id == int(access.account.id),
            PortalAdminRequest.requester_user_id == int(actor.id),
        )
        if status:
            stmt = stmt.where(PortalAdminRequest.status == status)
        rows = self.db.scalars(
            stmt.order_by(PortalAdminRequest.created_at.desc(), PortalAdminRequest.id.desc())
        ).all()
        return [self.to_out(row) for row in rows]

    def list_for_admin(
        self,
        query: PortalAdminRequestListingRequest,
    ) -> PaginatedPortalAdminRequestsResponse:
        stmt = select(PortalAdminRequest)
        if query.status:
            stmt = stmt.where(PortalAdminRequest.status == query.status)
        if query.request_type:
            stmt = stmt.where(PortalAdminRequest.request_type == query.request_type)
        if query.account_id is not None:
            stmt = stmt.where(PortalAdminRequest.account_id == query.account_id)
        if query.search:
            trimmed = query.search.strip()
            if trimmed:
                pattern = f"%{trimmed}%"
                stmt = (
                    stmt.outerjoin(S3Account, PortalAdminRequest.account_id == S3Account.id)
                    .where(
                        or_(
                            PortalAdminRequest.requester_email.ilike(pattern),
                            cast(PortalAdminRequest.payload, String).ilike(pattern),
                            S3Account.name.ilike(pattern),
                        )
                    )
                )

        rows, total, has_next = paginate_scalars(
            self.db,
            stmt,
            order_by=(PortalAdminRequest.created_at.desc(), PortalAdminRequest.id.desc()),
            page=query.page,
            page_size=query.page_size,
        )
        return PaginatedPortalAdminRequestsResponse(
            items=[self.to_out(row) for row in rows],
            total=total,
            page=query.page,
            page_size=query.page_size,
            has_next=has_next,
        )

    def add_admin_message(
        self,
        request_id: int,
        actor: User,
        message: str,
    ) -> PortalAdminRequestOut:
        actor_id = int(actor.id)
        actor_email = actor.email
        actor_role = actor.role
        message_at = utcnow()

        def persist_once(write_db: Session) -> int:
            row = self._load_request_from(write_db, request_id)
            self._append_message(
                row,
                author_user_id=actor_id,
                author_email=actor_email,
                author_role=actor_role,
                message=message,
                created_at=message_at,
            )
            row.updated_at = message_at
            write_db.flush()
            return int(row.id)

        run_replayable_db_unit(self.db, persist_once)
        row = self._load_request(request_id)
        self._notify_requester(
            request_id,
            title="Message on your Portal request",
            message=f"{actor_email} replied to your Portal request.",
            event_suffix=f"message:{row.messages[-1].id if row.messages else 'latest'}",
        )
        row = self._load_request(request_id)
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
        actor_id = int(actor.id)
        actor_email = actor.email
        actor_role = actor.role
        decided_at = utcnow()

        def reject_once(write_db: Session) -> int:
            row = self._load_request_from(write_db, request_id)
            self._ensure_pending(row)
            self._apply_request_decision(
                row,
                actor_id=actor_id,
                actor_email=actor_email,
                status="rejected",
                decided_at=decided_at,
            )
            if message:
                self._append_message(
                    row,
                    author_user_id=actor_id,
                    author_email=actor_email,
                    author_role=actor_role,
                    message=message,
                    created_at=decided_at,
                )
            return int(row.id)

        run_replayable_db_unit(self.db, reject_once)
        row = self._load_request(request_id)
        self._notify_requester(
            request_id,
            title="Portal request rejected",
            message="Your Portal request was rejected by a storage admin.",
            event_suffix="rejected",
        )
        row = self._load_request(request_id)
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
        processing_at = utcnow()

        def mark_processing_once(write_db: Session) -> int:
            row = self._load_request_from(write_db, request_id)
            self._ensure_pending(row)
            row.status = "processing"
            row.updated_at = processing_at
            return int(row.id)

        run_replayable_db_unit(self.db, mark_processing_once)
        row = self._load_request(request_id)

        try:
            result = self._execute_request(row)
        except Exception as exc:
            self._raise_execution_failure(
                request_id,
                actor,
                exc,
                scope="admin",
                action="approve_portal_request",
                notify_requester=True,
            )

        approved = self._finalize_approved_request(
            request_id,
            actor,
            result,
            message=message,
        )
        self._notify_requester(
            request_id,
            title="Portal request approved",
            message="Your Portal request was approved and applied.",
            event_suffix="approved",
        )
        approved = self._load_request(request_id)
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
        actor_id = int(actor.id)
        actor_email = actor.email
        decided_at = utcnow()

        def finalize_once(write_db: Session) -> None:
            row = self._load_request_from(write_db, request_id)
            self._apply_request_decision(
                row,
                actor_id=actor_id,
                actor_email=actor_email,
                status="failed",
                decided_at=decided_at,
            )
            row.error_message = detail

        run_replayable_db_unit(self.db, finalize_once)
        return self._load_request(request_id)

    def _finalize_approved_request(
        self,
        request_id: int,
        actor: User,
        result: dict[str, Any],
        *,
        message: Optional[str] = None,
    ) -> PortalAdminRequest:
        actor_id = int(actor.id)
        actor_email = actor.email
        actor_role = actor.role
        decided_at = utcnow()
        stored_result = dict(result)

        def finalize_once(write_db: Session) -> None:
            row = self._load_request_from(write_db, request_id)
            self._apply_request_decision(
                row,
                actor_id=actor_id,
                actor_email=actor_email,
                status="approved",
                decided_at=decided_at,
            )
            row.result = dict(stored_result)
            row.error_message = None
            if message:
                self._append_message(
                    row,
                    author_user_id=actor_id,
                    author_email=actor_email,
                    author_role=actor_role,
                    message=message,
                    created_at=decided_at,
                )

        run_replayable_db_unit(self.db, finalize_once)
        return self._load_request(request_id)

    def to_out(self, row: PortalAdminRequest) -> PortalAdminRequestOut:
        return PortalAdminRequestOut(
            id=int(row.id),
            account_id=int(row.account_id),
            account_name=row.account.name if row.account else None,
            request_type=row.request_type,
            status=row.status,
            payload=row.payload,
            error_message=row.error_message,
            requester_user_id=row.requester_user_id,
            requester_email=row.requester_email,
            decided_by_email=row.decided_by_email,
            decided_at=row.decided_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
            messages=[
                PortalAdminRequestMessageOut(
                    id=int(message.id),
                    author_email=message.author_email,
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
                row.payload,
            )
        if row.request_type == "portal_user_removal":
            return self.collaborator_requests.execute_user_removal(
                row,
                row.payload,
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
                **row.payload,
            },
            strict=True,
        )
        direction = payload.direction
        target_value = payload.target_quota_value
        target_unit = payload.target_quota_unit
        target_bytes = size_to_bytes(target_value, target_unit)
        current_size_gb, current_objects = self.account_metrics.get_quota(
            S3ExecutionContext.from_account(row.account)
        )
        current_bytes = size_to_bytes(current_size_gb, "GiB") if current_size_gb is not None else None
        if current_bytes is not None and target_bytes is not None:
            if direction == "increase" and target_bytes <= current_bytes:
                raise ValueError("Requested quota must be greater than the current quota")
            if direction == "decrease" and target_bytes >= current_bytes:
                raise ValueError("Requested quota must be lower than the current quota")
        self.account_repository.ensure_not_pending_deletion(int(row.account_id))
        self.account_quota.update(
            row.account,
            target_value,
            current_objects,
            target_unit,
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
                **row.payload,
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
        usage = PortalService(self.db).get_usage(actor, access)
        used_bytes = usage.used_bytes
        if used_bytes is not None and target_bytes < int(used_bytes):
            raise ValueError("Requested quota cannot be lower than the space already used")

    def _load_request(self, request_id: int) -> PortalAdminRequest:
        return self._load_request_from(self.db, request_id)

    def _ensure_pending(self, row: PortalAdminRequest) -> None:
        if row.status != "pending":
            if row.status == "processing":
                raise PortalRequestConflict("Request is already being processed")
            if row.status in REQUEST_FINAL_STATUSES:
                raise PortalRequestConflict("Request has already been decided")
            raise PortalRequestConflict("Request cannot be modified")

    def _normalize_create_payload(self, payload: PortalAdminRequestCreate) -> tuple[str, dict[str, Any]]:
        if isinstance(payload, PortalUserRemovalRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        if isinstance(payload, PortalAccountQuotaChangeRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        if isinstance(payload, PortalSettingChangeRequestCreate):
            return payload.request_type, payload.model_dump(mode="json", exclude={"request_type"}, exclude_none=True)
        raise ValueError("Unsupported Portal request payload")
