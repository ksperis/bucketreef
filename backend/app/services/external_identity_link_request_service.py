# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.db import ExternalIdentity, ExternalIdentityLinkAttempt, ExternalIdentityLinkRequest, User
from app.core.domain_enums import UserRole
from app.services.auth_session_service import AuthSessionService
from app.services.external_identity_query_service import ExternalIdentityQueryService
from app.services.user_notifications_service import UserNotificationsService
from app.utils.normalize import normalize_optional_string
from app.utils.time import utcnow


class ExternalIdentityLinkRequestService:
    """Manage external-identity approval requests and their side effects."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.queries = ExternalIdentityQueryService(db)

    def decide(
        self,
        request_id: str,
        *,
        superadmin: User,
        approve: bool,
        reason: Optional[str] = None,
    ) -> ExternalIdentityLinkRequest:
        now = utcnow()
        superadmin_id = int(superadmin.id)
        decision_reason = normalize_optional_string(reason)
        identity_id = str(uuid.uuid4()) if approve else None

        def decide_once(write_db: Session) -> str:
            service = ExternalIdentityLinkRequestService(write_db)
            write_superadmin = write_db.get(User, superadmin_id)
            if write_superadmin is None:
                raise ValueError("Administrator no longer exists")
            request = service._require_pending(request_id, now)
            request.status = "approved" if approve else "rejected"
            request.decided_at = now
            request.decided_by_user_id = write_superadmin.id
            request.decision_reason = decision_reason
            user = write_db.get(User, request.user_id)
            if not user:
                raise ValueError("Target user no longer exists")
            if approve:
                service._create_approved_identity(
                    request,
                    user,
                    now,
                    identity_id=identity_id,
                )
            service._sync_attempt_decision(request, approve=approve)
            request.decision_source = "administrator"
            service._notify_decision(request, user, now, approve=approve)
            if approve:
                AuthSessionService(write_db).revoke_all_for_user_in_transaction(
                    user,
                    "external_identity_changed",
                    increment_version=False,
                    now=now,
                )
            write_db.flush()
            return request.id

        persisted_id = run_replayable_db_unit(self.db, decide_once)
        request = self.db.get(
            ExternalIdentityLinkRequest,
            persisted_id,
            populate_existing=True,
        )
        if request is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("External identity link request could not be reloaded")
        return request

    def request(
        self,
        *,
        user: User,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: str,
        email_verified: bool = False,
        request_source: Optional[str] = None,
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> ExternalIdentityLinkRequest:
        user_id = int(user.id)
        now = utcnow()
        request_id = str(uuid.uuid4())

        def request_once(write_db: Session) -> str:
            write_user = write_db.get(User, user_id)
            if write_user is None:
                raise ValueError("Target user no longer exists")
            request = ExternalIdentityLinkRequestService(write_db).request_in_transaction(
                user=write_user,
                provider_type=provider_type,
                provider_id=provider_id,
                issuer=issuer,
                subject=subject,
                email=email,
                email_verified=email_verified,
                request_source=request_source,
                full_name=full_name,
                picture_url=picture_url,
                now=now,
                request_id=request_id,
            )
            return request.id

        persisted_id = run_replayable_db_unit(self.db, request_once)
        request = self.db.get(
            ExternalIdentityLinkRequest,
            persisted_id,
            populate_existing=True,
        )
        if request is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("External identity link request could not be reloaded")
        return request

    def request_in_transaction(
        self,
        *,
        user: User,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: str,
        email_verified: bool = False,
        request_source: Optional[str] = None,
        full_name: Optional[str],
        picture_url: Optional[str],
        now: Optional[datetime] = None,
        request_id: Optional[str] = None,
    ) -> ExternalIdentityLinkRequest:
        """Create or refresh a link request without committing the caller transaction."""
        now = now or utcnow()
        request_id = request_id or str(uuid.uuid4())
        existing = self._find(
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
        )
        reusable = self._reuse_active(
            existing,
            user=user,
            provider_id=provider_id,
            issuer=issuer,
            email=email,
            email_verified=email_verified,
            request_source=request_source,
            full_name=full_name,
            picture_url=picture_url,
            now=now,
        )
        if reusable is not None:
            return reusable

        request = self._prepare(
            existing,
            user=user,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=email_verified,
            request_source=request_source,
            full_name=full_name,
            picture_url=picture_url,
            now=now,
            request_id=request_id,
        )
        self.db.add(request)
        self.db.flush()
        self._notify_admins(request, user)
        return request

    def close_pending(
        self,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        user_id: int,
        source: str,
    ) -> None:
        statement = select(ExternalIdentityLinkRequest).where(
            ExternalIdentityLinkRequest.provider_type == provider_type,
            ExternalIdentityLinkRequest.subject == subject,
            ExternalIdentityLinkRequest.status == "pending",
        )
        if provider_type == "oidc":
            statement = statement.where(ExternalIdentityLinkRequest.issuer == issuer)
        else:
            statement = statement.where(ExternalIdentityLinkRequest.provider_id == provider_id)
        request = self.db.scalar(statement)
        if request is None:
            return
        request.user_id = user_id
        request.status = "approved"
        request.decided_at = utcnow()
        request.decision_source = source
        request.decision_reason = "Linked by configured identity policy"

    def _require_pending(
        self,
        request_id: str,
        now: datetime,
    ) -> ExternalIdentityLinkRequest:
        request = self.db.scalar(
            select(ExternalIdentityLinkRequest)
            .where(ExternalIdentityLinkRequest.id == request_id)
            .with_for_update()
        )
        if not request or request.status != "pending" or request.expires_at <= now:
            raise ValueError("External identity link request is unavailable")
        return request

    def _create_approved_identity(
        self,
        request: ExternalIdentityLinkRequest,
        user: User,
        now: datetime,
        identity_id: Optional[str],
    ) -> None:
        if self.queries.find_mapping(
            request.provider_type,
            request.provider_id,
            request.subject,
            issuer=request.issuer,
            include_revoked=True,
        ):
            raise ValueError("External identity is already linked")
        identity = ExternalIdentity(
            id=identity_id or str(uuid.uuid4()),
            user_id=request.user_id,
            provider_type=request.provider_type,
            provider_id=request.provider_id,
            issuer=request.issuer,
            subject=request.subject,
            email=request.email,
            email_verified=request.email_verified,
            created_at=now,
            link_source="manual_approval",
        )
        user.auth_version += 1
        self.db.add(identity)

    def _sync_attempt_decision(
        self,
        request: ExternalIdentityLinkRequest,
        *,
        approve: bool,
    ) -> None:
        conditions = [
            ExternalIdentityLinkAttempt.user_id == request.user_id,
            ExternalIdentityLinkAttempt.provider_type == request.provider_type,
            ExternalIdentityLinkAttempt.provider_id == request.provider_id,
            ExternalIdentityLinkAttempt.subject == request.subject,
            ExternalIdentityLinkAttempt.status == "admin_requested",
        ]
        if request.provider_type == "oidc":
            conditions.append(ExternalIdentityLinkAttempt.issuer == request.issuer)
        attempts = self.db.scalars(select(ExternalIdentityLinkAttempt).where(*conditions)).all()
        for attempt in attempts:
            attempt.status = "admin_approved" if approve else "admin_rejected"

    def _notify_decision(
        self,
        request: ExternalIdentityLinkRequest,
        user: User,
        now: datetime,
        *,
        approve: bool,
    ) -> None:
        UserNotificationsService(self.db).create_notifications(
            user_ids=[user.id],
            notification_type="identity_changed",
            severity="info" if approve else "warning",
            title=(
                "External identity link approved"
                if approve
                else "External identity link rejected"
            ),
            message=(
                f"Your identity link request for {request.provider_id} was approved. Sign in again to use it."
                if approve
                else f"Your identity link request for {request.provider_id} was rejected."
            ),
            subject_type=None,
            event_key=f"external_identity_link_decision:{request.id}:{request.status}:{now.isoformat()}",
            payload={
                "request_id": request.id,
                "provider_type": request.provider_type,
                "provider_id": request.provider_id,
                "status": request.status,
            },
            created_at=now,
        )

    def _find(
        self,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
    ) -> ExternalIdentityLinkRequest | None:
        statement = select(ExternalIdentityLinkRequest).where(
            ExternalIdentityLinkRequest.provider_type == provider_type,
            ExternalIdentityLinkRequest.subject == subject,
        )
        if provider_type == "oidc":
            statement = statement.where(ExternalIdentityLinkRequest.issuer == issuer)
        else:
            statement = statement.where(ExternalIdentityLinkRequest.provider_id == provider_id)
        return self.db.scalar(statement)

    def _reuse_active(
        self,
        request: ExternalIdentityLinkRequest | None,
        *,
        user: User,
        provider_id: str,
        issuer: Optional[str],
        email: str,
        email_verified: bool,
        request_source: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
        now: datetime,
    ) -> ExternalIdentityLinkRequest | None:
        if not request or request.status != "pending" or request.expires_at <= now:
            return None
        if request.user_id == user.id and request.provider_id == provider_id:
            request.issuer = issuer
            request.email = email
            request.email_verified = email_verified
            request.request_source = request_source
            request.display_name = full_name
            request.picture_url = picture_url
        return request

    def _prepare(
        self,
        existing: ExternalIdentityLinkRequest | None,
        *,
        user: User,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: str,
        email_verified: bool,
        request_source: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
        now: datetime,
        request_id: str,
    ) -> ExternalIdentityLinkRequest:
        if existing:
            existing.status = "pending"
            existing.created_at = now
            existing.expires_at = now + timedelta(hours=24)
            existing.decided_at = None
            existing.decided_by_user_id = None
            existing.decision_reason = None
            existing.decision_source = None
            existing.user_id = user.id
            existing.provider_id = provider_id
            existing.issuer = issuer
            existing.email = email
            existing.email_verified = email_verified
            existing.request_source = request_source
            existing.display_name = full_name
            existing.picture_url = picture_url
            return existing
        return ExternalIdentityLinkRequest(
            id=request_id,
            user_id=user.id,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=email_verified,
            request_source=request_source,
            display_name=full_name,
            picture_url=picture_url,
            status="pending",
            created_at=now,
            expires_at=now + timedelta(hours=24),
        )

    def _notify_admins(
        self,
        request: ExternalIdentityLinkRequest,
        target_user: User,
    ) -> None:
        recipient_roles = {UserRole.UI_SUPERADMIN.value}
        if target_user.role in {UserRole.UI_USER.value, UserRole.UI_NONE.value}:
            recipient_roles.add(UserRole.UI_ADMIN.value)
        recipient_ids = [
            int(user_id)
            for user_id in self.db.scalars(
                select(User.id).where(
                    User.is_active.is_(True),
                    User.role.in_(sorted(recipient_roles)),
                )
            ).all()
        ]
        UserNotificationsService(self.db).create_notifications(
            user_ids=recipient_ids,
            notification_type="identity_link_request",
            severity="warning",
            title="Identity link approval requested",
            message=(
                f"{target_user.email} requested an external identity link "
                f"through {request.provider_type}:{request.provider_id}."
            ),
            subject_type="identity_request",
            event_key=f"identity_link_request:{request.id}:{request.created_at.isoformat()}",
            payload={
                "request_id": request.id,
                "target_user_id": int(target_user.id),
                "target_user_email": target_user.email,
                "provider_type": request.provider_type,
                "provider_id": request.provider_id,
                "expires_at": request.expires_at.isoformat(),
            },
            created_at=request.created_at,
        )
