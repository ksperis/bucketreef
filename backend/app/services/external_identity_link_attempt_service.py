# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persist and validate external-identity link attempts."""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db import ExternalIdentityLinkAttempt, ExternalIdentityLinkRequest, User
from app.services.external_identity_link_contracts import (
    ExternalIdentityLinkError,
    normalize_link_oidc_issuer,
    normalize_link_provider_id,
)
from app.services.external_identity_link_request_service import ExternalIdentityLinkRequestService
from app.utils.normalize import normalize_optional_email
from app.utils.time import utcnow


class ExternalIdentityLinkAttemptService:
    def __init__(self, db: Session, settings: Optional[Settings] = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    def create_login_collision_attempt(
        self,
        *,
        user: User,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: Optional[str],
        email_verified: bool,
        display_name: Optional[str],
        picture_url: Optional[str],
        browser_secret_hash: str,
        redirect_path: Optional[str],
    ) -> ExternalIdentityLinkAttempt:
        if not browser_secret_hash:
            raise ExternalIdentityLinkError("External identity browser binding is required")
        provider_kind = self._normalize_provider_type(provider_type)
        provider_key = normalize_link_provider_id(provider_id)
        normalized_issuer = normalize_link_oidc_issuer(issuer) if provider_kind == "oidc" else None
        now = utcnow()
        row = ExternalIdentityLinkAttempt(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type=provider_kind,
            provider_id=provider_key,
            issuer=normalized_issuer,
            subject=subject,
            email=normalize_optional_email(email),
            email_verified=bool(email_verified),
            display_name=display_name,
            picture_url=picture_url,
            source="login_collision",
            browser_secret_hash=browser_secret_hash,
            status="pending",
            redirect_path=redirect_path,
            created_at=now,
            expires_at=now + timedelta(seconds=self.settings.oidc_link_attempt_ttl_seconds),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def create_profile_attempt(
        self,
        *,
        user: User,
        provider_id: str,
        issuer: str,
        browser_secret_hash: str,
        auth_session_id: str,
        mfa_verified_at: Optional[datetime],
        redirect_path: Optional[str],
    ) -> ExternalIdentityLinkAttempt:
        if not browser_secret_hash:
            raise ExternalIdentityLinkError("External identity browser binding is required")
        provider_key = normalize_link_provider_id(provider_id)
        now = utcnow()
        row = ExternalIdentityLinkAttempt(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type="oidc",
            provider_id=provider_key,
            issuer=normalize_link_oidc_issuer(issuer),
            source="profile",
            browser_secret_hash=browser_secret_hash,
            initiating_auth_session_id=auth_session_id,
            proof_method="session_step_up",
            proof_verified_at=now,
            mfa_verified_at=mfa_verified_at,
            status="pending",
            redirect_path=redirect_path,
            created_at=now,
            expires_at=now + timedelta(seconds=self.settings.oidc_link_attempt_ttl_seconds),
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row

    def request_admin_approval(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
    ) -> ExternalIdentityLinkRequest:
        attempt = self.require_attempt(attempt_id, browser_secret_hash)
        user = self.require_user(attempt)
        if attempt.status != "pending" or attempt.consumed_at is not None:
            raise ExternalIdentityLinkError("External identity link attempt is unavailable")
        if not attempt.subject:
            raise ExternalIdentityLinkError("External identity must be validated before requesting approval")
        request = ExternalIdentityLinkRequestService(self.db).request(
            user=user,
            provider_type=attempt.provider_type,
            provider_id=attempt.provider_id,
            issuer=attempt.issuer,
            subject=attempt.subject,
            email=attempt.email or user.email,
            email_verified=bool(attempt.email_verified),
            request_source=attempt.source,
            full_name=attempt.display_name,
            picture_url=attempt.picture_url,
        )
        refreshed = self.db.get(ExternalIdentityLinkAttempt, attempt.id)
        if refreshed:
            refreshed.status = "admin_requested"
            if request.expires_at > refreshed.expires_at:
                refreshed.expires_at = request.expires_at
            self.db.add(refreshed)
            self.db.commit()
        return request

    def require_attempt(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        *,
        for_update: bool = False,
    ) -> ExternalIdentityLinkAttempt:
        statement = select(ExternalIdentityLinkAttempt).where(ExternalIdentityLinkAttempt.id == attempt_id)
        if for_update:
            statement = statement.with_for_update()
        attempt = self.db.scalar(statement)
        if attempt is None or not browser_secret_hash:
            raise ExternalIdentityLinkError("External identity link attempt is unavailable")
        if not secrets.compare_digest(attempt.browser_secret_hash, browser_secret_hash):
            raise ExternalIdentityLinkError("External identity link attempt browser binding mismatch")
        if attempt.expires_at <= utcnow():
            raise ExternalIdentityLinkError("External identity link attempt expired")
        if attempt.consumed_at is not None and attempt.status != "completed":
            raise ExternalIdentityLinkError("External identity link attempt has already been consumed")
        return attempt

    def require_user(self, attempt: ExternalIdentityLinkAttempt) -> User:
        user = self.db.get(User, attempt.user_id)
        if user is None or not user.is_active:
            raise ExternalIdentityLinkError("Target account is unavailable")
        return user

    @staticmethod
    def _normalize_provider_type(provider_type: str) -> str:
        value = str(provider_type or "").strip().lower()
        if value not in {"oidc", "ldap"}:
            raise ExternalIdentityLinkError("Unsupported external identity provider type")
        return value
