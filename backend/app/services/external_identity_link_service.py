# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db_transactions import commit_or_rollback
from app.core.security import verify_password
from app.db import ExternalIdentity, ExternalIdentityLinkRequest, ExternalIdentityLinkAttempt, User
from app.models.external_identity_link import ExternalIdentityLinkProofMethod, ExternalIdentityLinkStatus
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionService, SessionCredentials
from app.services.external_identity_link_attempt_service import ExternalIdentityLinkAttemptService
from app.services.external_identity_link_contracts import (
    ExternalIdentityLinkError,
    normalize_link_oidc_issuer,
    normalize_link_provider_id,
)
from app.services.identity_security_requirements import passkey_required_for_role
from app.services.ldap_service import LDAPAuthService
from app.services.user_notifications_service import UserNotificationsService
from app.services.users_service import get_users_service
from app.services.webauthn_service import WebAuthnService
from app.utils.normalize import normalize_optional_email
from app.utils.time import utcnow


@dataclass(frozen=True)
class ExternalIdentityLinkCompletion:
    credentials: SessionCredentials
    user: User
    identity: ExternalIdentity
    redirect_path: Optional[str]


class ExternalIdentityLinkService:
    def __init__(self, db: Session, settings: Optional[Settings] = None) -> None:
        self.db = db
        self.settings = settings or get_settings()
        self.attempts = ExternalIdentityLinkAttemptService(db, self.settings)

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
        return self.attempts.create_login_collision_attempt(
            user=user,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=email_verified,
            display_name=display_name,
            picture_url=picture_url,
            browser_secret_hash=browser_secret_hash,
            redirect_path=redirect_path,
        )

    def create_profile_attempt(
        self,
        *,
        user: User,
        provider_id: str,
        issuer: str,
        browser_secret_hash: str,
        mfa_verified_at: Optional[datetime],
        redirect_path: Optional[str],
    ) -> ExternalIdentityLinkAttempt:
        return self.attempts.create_profile_attempt(
            user=user,
            provider_id=provider_id,
            issuer=issuer,
            browser_secret_hash=browser_secret_hash,
            mfa_verified_at=mfa_verified_at,
            redirect_path=redirect_path,
        )

    def status(self, attempt_id: str, browser_secret_hash: Optional[str]) -> ExternalIdentityLinkStatus:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash)
        user = self.attempts.require_user(attempt)
        return self._status_model(attempt, user)

    def record_oidc_identity(
        self,
        *,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        provider_id: str,
        issuer: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
        email_verified: bool,
    ) -> ExternalIdentityLinkStatus:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash, for_update=True)
        if attempt.status != "pending" or attempt.consumed_at is not None:
            raise ExternalIdentityLinkError("External identity link attempt is unavailable")
        if attempt.provider_type != "oidc":
            raise ExternalIdentityLinkError("OIDC identity cannot continue this link attempt")
        provider_key = normalize_link_provider_id(provider_id)
        normalized_issuer = normalize_link_oidc_issuer(issuer)
        if attempt.provider_id != provider_key or attempt.issuer != normalized_issuer:
            raise ExternalIdentityLinkError("OIDC link identity does not match the requested provider")

        existing = self.db.scalar(
            select(ExternalIdentity).where(
                ExternalIdentity.provider_type == "oidc",
                ExternalIdentity.issuer == normalized_issuer,
                ExternalIdentity.subject == subject,
            )
        )
        if existing:
            if existing.user_id != attempt.user_id:
                raise ExternalIdentityLinkError("OIDC identity belongs to another user")
            if existing.revoked_at is not None:
                raise ExternalIdentityLinkError("OIDC identity is revoked")
        attempt.subject = subject
        attempt.email = normalize_optional_email(email)
        attempt.email_verified = email_verified
        attempt.display_name = full_name
        attempt.picture_url = picture_url
        self.db.add(attempt)
        commit_or_rollback(self.db)
        return self._status_model(attempt, self.attempts.require_user(attempt))

    def verify_password(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        password: str,
    ) -> ExternalIdentityLinkStatus:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash, for_update=True)
        user = self.attempts.require_user(attempt)
        if not user.hashed_password or not verify_password(password, user.hashed_password):
            raise ExternalIdentityLinkError("Invalid account password")
        self._mark_proof(attempt, "password")
        commit_or_rollback(self.db)
        return self._status_model(attempt, user)

    def verify_ldap(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        *,
        provider_id: str,
        username: str,
        password: str,
    ) -> ExternalIdentityLinkStatus:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash, for_update=True)
        user = self.attempts.require_user(attempt)
        ldap = LDAPAuthService(self.db, get_users_service(self.db), self.settings)
        identity = ldap.verify_credentials(provider_id, username, password)
        linked = self.db.scalar(
            select(ExternalIdentity).where(
                ExternalIdentity.user_id == user.id,
                ExternalIdentity.provider_type == "ldap",
                ExternalIdentity.provider_id == identity.provider,
                ExternalIdentity.subject == identity.subject,
                ExternalIdentity.revoked_at.is_(None),
            )
        )
        if linked is None:
            raise ExternalIdentityLinkError("LDAP identity is not linked to the target account")
        self._mark_proof(attempt, f"ldap:{identity.provider}")
        commit_or_rollback(self.db)
        return self._status_model(attempt, user)

    def verify_oidc_proof(
        self,
        *,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        provider_id: str,
        issuer: str,
        subject: str,
    ) -> ExternalIdentityLinkStatus:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash, for_update=True)
        user = self.attempts.require_user(attempt)
        provider_key = normalize_link_provider_id(provider_id)
        linked = self.db.scalar(
            select(ExternalIdentity).where(
                ExternalIdentity.user_id == user.id,
                ExternalIdentity.provider_type == "oidc",
                ExternalIdentity.provider_id == provider_key,
                ExternalIdentity.issuer == normalize_link_oidc_issuer(issuer),
                ExternalIdentity.subject == subject,
                ExternalIdentity.revoked_at.is_(None),
            )
        )
        if linked is None:
            raise ExternalIdentityLinkError("OIDC proof identity is not linked to the target account")
        self._mark_proof(attempt, f"oidc:{provider_key}")
        commit_or_rollback(self.db)
        AuditService(self.db).record_action(
            user=user,
            scope="security",
            action="external_identity_account_proof",
            entity_type="external_identity_link_attempt",
            entity_id=attempt.id,
            metadata={"method": "oidc", "provider_id": provider_key},
        )
        return self._status_model(attempt, user)

    def mark_mfa_verified(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
    ) -> ExternalIdentityLinkStatus:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash, for_update=True)
        user = self.attempts.require_user(attempt)
        if attempt.proof_verified_at is None:
            raise ExternalIdentityLinkError("Account proof is required before MFA")
        attempt.mfa_verified_at = utcnow()
        self.db.add(attempt)
        commit_or_rollback(self.db)
        return self._status_model(attempt, user)

    def request_admin_approval(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
    ) -> ExternalIdentityLinkRequest:
        return self.attempts.request_admin_approval(attempt_id, browser_secret_hash)

    def confirm(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        *,
        ip_address: Optional[str],
        user_agent: Optional[str],
    ) -> ExternalIdentityLinkCompletion:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash, for_update=True)
        user = self.attempts.require_user(attempt)
        if self._stage(attempt, user) != "confirm" or not attempt.subject:
            raise ExternalIdentityLinkError("External identity link attempt is not ready for confirmation")

        now = utcnow()
        identity = self._upsert_confirmed_identity(attempt, user, now)
        self._approve_matching_link_requests(attempt, user, now)
        credentials = self._replace_user_credentials_after_link(
            attempt,
            user,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        attempt.status = "completed"
        attempt.consumed_at = now
        self.db.add(attempt)
        self._notify_identity_linked(attempt, user, identity, now)
        commit_or_rollback(self.db)
        self.db.refresh(identity)
        return ExternalIdentityLinkCompletion(
            credentials=credentials,
            user=user,
            identity=identity,
            redirect_path=attempt.redirect_path,
        )

    def _upsert_confirmed_identity(
        self,
        attempt: ExternalIdentityLinkAttempt,
        user: User,
        now: datetime,
    ) -> ExternalIdentity:
        conditions = [
            ExternalIdentity.provider_type == attempt.provider_type,
            ExternalIdentity.subject == attempt.subject,
        ]
        if attempt.provider_type == "oidc":
            conditions.append(ExternalIdentity.issuer == attempt.issuer)
        else:
            conditions.append(ExternalIdentity.provider_id == attempt.provider_id)
        identity = self.db.scalar(select(ExternalIdentity).where(*conditions).with_for_update())
        if identity:
            if identity.user_id != user.id:
                raise ExternalIdentityLinkError("External identity belongs to another user")
            if identity.revoked_at is not None:
                raise ExternalIdentityLinkError("External identity is revoked")
            identity.provider_id = attempt.provider_id
            identity.issuer = attempt.issuer
            identity.email = attempt.email
            identity.email_verified = attempt.email_verified
        else:
            identity = ExternalIdentity(
                id=str(uuid.uuid4()),
                user_id=user.id,
                provider_type=attempt.provider_type,
                provider_id=attempt.provider_id,
                issuer=attempt.issuer,
                subject=attempt.subject,
                email=attempt.email,
                email_verified=attempt.email_verified,
                created_at=now,
                link_source="reauthenticated",
            )
        self.db.add(identity)
        return identity

    def _approve_matching_link_requests(
        self,
        attempt: ExternalIdentityLinkAttempt,
        user: User,
        now: datetime,
    ) -> None:
        conditions = [
            ExternalIdentityLinkRequest.user_id == user.id,
            ExternalIdentityLinkRequest.provider_type == attempt.provider_type,
            ExternalIdentityLinkRequest.provider_id == attempt.provider_id,
            ExternalIdentityLinkRequest.subject == attempt.subject,
            ExternalIdentityLinkRequest.status == "pending",
        ]
        if attempt.provider_type == "oidc":
            conditions.append(ExternalIdentityLinkRequest.issuer == attempt.issuer)
        self.db.execute(
            update(ExternalIdentityLinkRequest)
            .where(*conditions)
            .values(
                status="approved",
                decided_at=now,
                decision_source="reauthenticated",
                decision_reason="Linked after account reauthentication",
            )
            .execution_options(synchronize_session=False)
        )

    def _replace_user_credentials_after_link(
        self,
        attempt: ExternalIdentityLinkAttempt,
        user: User,
        *,
        ip_address: Optional[str],
        user_agent: Optional[str],
    ) -> SessionCredentials:
        user.auth_version += 1
        self.db.add(user)
        sessions = AuthSessionService(self.db, self.settings)
        sessions.revoke_all_for_user_in_transaction(
            user,
            "external_identity_changed",
            increment_version=False,
        )
        return sessions.create_for_user_in_transaction(
            user,
            auth_type=f"{attempt.provider_type}-link",
            ip_address=ip_address,
            user_agent=user_agent,
            mfa_verified=attempt.mfa_verified_at is not None,
        )

    def _notify_identity_linked(
        self,
        attempt: ExternalIdentityLinkAttempt,
        user: User,
        identity: ExternalIdentity,
        now: datetime,
    ) -> None:
        UserNotificationsService(self.db).create_notifications(
            user_ids=[user.id],
            notification_type="identity_changed",
            severity="info",
            title="External identity linked",
            message=(
                f"An {attempt.provider_type.upper()} identity from "
                f"{attempt.provider_id} was linked to your account."
            ),
            subject_type=None,
            event_key=f"external_identity_linked:{identity.id}:{now.isoformat()}",
            payload={"identity_id": identity.id, "provider_id": attempt.provider_id},
            created_at=now,
        )

    def proof_oidc_identity(
        self,
        attempt_id: str,
        browser_secret_hash: Optional[str],
        provider_id: str,
    ) -> ExternalIdentity:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash)
        provider_key = normalize_link_provider_id(provider_id)
        row = self.db.scalar(
            select(ExternalIdentity)
            .where(
                ExternalIdentity.user_id == attempt.user_id,
                ExternalIdentity.provider_type == "oidc",
                ExternalIdentity.provider_id == provider_key,
                ExternalIdentity.revoked_at.is_(None),
            )
            .order_by(ExternalIdentity.created_at.asc(), ExternalIdentity.id.asc())
            .limit(1)
        )
        if row is None or not row.issuer:
            raise ExternalIdentityLinkError("OIDC proof method is unavailable")
        return row

    def target_user(self, attempt_id: str, browser_secret_hash: Optional[str]) -> User:
        attempt = self.attempts.require_attempt(attempt_id, browser_secret_hash)
        return self.attempts.require_user(attempt)

    def _status_model(self, attempt: ExternalIdentityLinkAttempt, user: User) -> ExternalIdentityLinkStatus:
        return ExternalIdentityLinkStatus(
            attempt_id=attempt.id,
            target_email=user.email,
            provider_type=attempt.provider_type,
            provider_id=attempt.provider_id,
            source=attempt.source,
            stage=self._stage(attempt, user),
            proof_methods=self._proof_methods(user),
            redirect_path=attempt.redirect_path,
            expires_at=attempt.expires_at,
        )

    def _stage(self, attempt: ExternalIdentityLinkAttempt, user: User) -> str:
        if attempt.status == "completed":
            return "completed"
        if attempt.status == "admin_requested":
            return "admin_requested"
        if attempt.status == "admin_approved":
            return "admin_approved"
        if attempt.status == "admin_rejected":
            return "admin_rejected"
        if not attempt.subject:
            return "identity"
        if attempt.proof_verified_at is None:
            return "proof"
        webauthn = WebAuthnService(self.db, self.settings)
        has_passkey = webauthn.has_credentials(user.id)
        if (has_passkey or passkey_required_for_role(self.db, user.role)) and not self._has_recent_mfa(
            attempt.mfa_verified_at
        ):
            return "mfa" if has_passkey else "mfa_enrollment"
        return "confirm"

    def _has_recent_mfa(self, verified_at: Optional[datetime]) -> bool:
        return bool(
            verified_at
            and verified_at >= utcnow() - timedelta(minutes=self.settings.mfa_recent_minutes)
        )

    def _proof_methods(self, user: User) -> list[ExternalIdentityLinkProofMethod]:
        methods: list[ExternalIdentityLinkProofMethod] = []
        if user.hashed_password:
            methods.append(ExternalIdentityLinkProofMethod(type="password"))
        rows = self.db.scalars(
            select(ExternalIdentity).where(
                ExternalIdentity.user_id == user.id,
                ExternalIdentity.revoked_at.is_(None),
            )
        ).all()
        seen: set[tuple[str, str]] = set()
        for row in rows:
            if row.provider_type == "ldap":
                key = ("ldap", row.provider_id)
                if key not in seen:
                    methods.append(
                        ExternalIdentityLinkProofMethod(type="ldap", provider_id=row.provider_id, display_name=row.provider_id)
                    )
                    seen.add(key)
            elif row.provider_type == "oidc" and row.issuer:
                key = ("oidc", row.provider_id)
                if key not in seen:
                    methods.append(
                        ExternalIdentityLinkProofMethod(type="oidc", provider_id=row.provider_id, display_name=row.provider_id)
                    )
                    seen.add(key)
        return methods

    def _mark_proof(self, attempt: ExternalIdentityLinkAttempt, method: str) -> None:
        if attempt.status != "pending" or attempt.consumed_at is not None or not attempt.subject:
            raise ExternalIdentityLinkError("External identity link attempt is unavailable")
        attempt.proof_method = method
        attempt.proof_verified_at = utcnow()
        self.db.add(attempt)
