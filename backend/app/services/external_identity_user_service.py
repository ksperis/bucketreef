# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import uuid
from typing import NoReturn, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.core.domain_errors import ExternalIdentityConflictError, ExternalIdentityNotFoundError
from app.db import ExternalIdentity, ExternalIdentityLinkRequest, User
from app.core.domain_enums import UserRole
from app.services.auth_session_service import AuthSessionService
from app.services.audit_service import AuditService
from app.services.external_identity_link_request_service import ExternalIdentityLinkRequestService
from app.services.external_identity_link_attempt_service import ExternalIdentityLinkAttemptService
from app.services.external_identity_query_service import ExternalIdentityQueryService
from app.services.user_notifications_service import UserNotificationsService
from app.utils.identity_provider_ids import normalize_identity_provider_id, normalize_oidc_issuer
from app.utils.normalize import normalize_optional_email
from app.utils.time import utcnow


class ExternalIdentityLinkRequiredError(ValueError):
    def __init__(self, request_id: str) -> None:
        super().__init__("External identity linking requires administrator approval")
        self.request_id = request_id


class ExternalIdentityReauthenticationRequiredError(ValueError):
    def __init__(self, attempt_id: str) -> None:
        super().__init__("External identity linking requires account reauthentication")
        self.attempt_id = attempt_id


class ExternalIdentityUserService:
    """Resolve immutable provider subjects and apply the configured linking policy."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.queries = ExternalIdentityQueryService(db)
        self.link_requests = ExternalIdentityLinkRequestService(db)

    def get_or_create_oidc_user(
        self,
        *,
        provider: str,
        issuer: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        picture_url: Optional[str],
        email_verified: bool = True,
        linking_policy: str = "manual",
        trusted_email_domains: Optional[list[str]] = None,
        browser_secret_hash: Optional[str] = None,
        redirect_path: Optional[str] = None,
    ) -> tuple[User, bool]:
        return self._get_or_create(
            provider_type="oidc",
            provider_id=provider,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=bool(email_verified and normalize_optional_email(email)),
            full_name=full_name,
            picture_url=picture_url,
            linking_policy=linking_policy,
            trusted_email_domains=trusted_email_domains or [],
            browser_secret_hash=browser_secret_hash,
            redirect_path=redirect_path,
        )

    def get_or_create_ldap_user(
        self,
        *,
        provider: str,
        subject: str,
        email: Optional[str],
        full_name: Optional[str],
        linking_policy: str = "manual",
        browser_secret_hash: Optional[str] = None,
        redirect_path: Optional[str] = None,
    ) -> tuple[User, bool]:
        return self._get_or_create(
            provider_type="ldap",
            provider_id=provider,
            issuer=None,
            subject=subject,
            email=email,
            email_verified=False,
            full_name=full_name,
            picture_url=None,
            linking_policy=linking_policy,
            trusted_email_domains=[],
            browser_secret_hash=browser_secret_hash,
            redirect_path=redirect_path,
        )

    def list_link_requests(self, *, include_decided: bool = False) -> list[ExternalIdentityLinkRequest]:
        return self.link_requests.list(include_decided=include_decided)

    def list_for_user(self, user_id: int, *, include_revoked: bool = False) -> list[ExternalIdentity]:
        return self.queries.list_for_user(user_id, include_revoked=include_revoked)

    def decide_link_request(
        self,
        request_id: str,
        *,
        superadmin: User,
        approve: bool,
        reason: Optional[str] = None,
    ) -> ExternalIdentityLinkRequest:
        return self.link_requests.decide(
            request_id,
            superadmin=superadmin,
            approve=approve,
            reason=reason,
        )

    def revoke_identity(self, identity_id: str, *, reason: str = "identity_revoked") -> ExternalIdentity:
        identity = self.db.get(ExternalIdentity, identity_id)
        if not identity or identity.revoked_at is not None:
            raise ExternalIdentityNotFoundError("External identity not found")
        now = utcnow()
        identity.revoked_at = now
        user = self.db.get(User, identity.user_id)
        if user:
            user.auth_version += 1
            self.db.add(user)
            UserNotificationsService(self.db).create_notifications(
                user_ids=[user.id],
                notification_type="identity_changed",
                severity="warning",
                title="External identity removed",
                message=f"The external identity from {identity.provider_id} was removed from your account.",
                subject_type=None,
                event_key=f"external_identity_revoked:{identity.id}:{now.isoformat()}",
                payload={
                    "identity_id": identity.id,
                    "provider_type": identity.provider_type,
                    "provider_id": identity.provider_id,
                },
                created_at=now,
            )
        self.db.add(identity)
        if user:
            AuthSessionService(self.db).revoke_all_for_user_in_transaction(
                user,
                reason,
                increment_version=False,
            )
        commit_or_rollback(self.db)
        self.db.refresh(identity)
        return identity

    def restore_identity(self, identity_id: str, *, reason: str = "identity_restored") -> ExternalIdentity:
        identity = self.db.get(ExternalIdentity, identity_id)
        if not identity or identity.revoked_at is None:
            raise ExternalIdentityNotFoundError("Revoked external identity not found")
        identity.revoked_at = None
        user = self.db.get(User, identity.user_id)
        if not user:
            raise ValueError("External identity target does not exist")
        user.auth_version += 1
        self.db.add_all([identity, user])
        AuthSessionService(self.db).revoke_all_for_user_in_transaction(
            user,
            reason,
            increment_version=False,
        )
        commit_or_rollback(self.db)
        self.db.refresh(identity)
        return identity

    def provision_identity(
        self,
        *,
        user: User,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str] = None,
        subject: str,
        email: Optional[str] = None,
        email_verified: bool = False,
        restore: bool = False,
        link_source: str = "administrator",
    ) -> tuple[ExternalIdentity, bool]:
        provider_kind = str(provider_type or "").strip().lower()
        normalized_subject = str(subject or "").strip()
        if provider_kind not in {"oidc", "ldap"}:
            raise ValueError("provider_type must be oidc or ldap")
        provider_key = normalize_identity_provider_id(provider_id)
        normalized_issuer = normalize_oidc_issuer(issuer) if provider_kind == "oidc" else None
        if not normalized_subject:
            raise ValueError("External subject is required")
        existing = self._find_mapping(
            provider_kind,
            provider_key,
            normalized_subject,
            issuer=normalized_issuer,
            include_revoked=True,
        )
        if existing:
            if existing.user_id != user.id:
                raise ExternalIdentityConflictError("External identity subject belongs to another user")
            if existing.revoked_at is None:
                return existing, False
            if not restore:
                raise ExternalIdentityConflictError(
                    "External identity is revoked; explicit restoration is required"
                )
            return self.restore_identity(existing.id, reason="external_identity_restored"), True

        identity = ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type=provider_kind,
            provider_id=provider_key,
            issuer=normalized_issuer,
            subject=normalized_subject,
            email=normalize_optional_email(email),
            email_verified=email_verified,
            created_at=utcnow(),
            link_source=link_source,
        )
        user.auth_version += 1
        self.db.add_all([identity, user])
        self.link_requests.close_pending(
            provider_type=provider_kind,
            provider_id=provider_key,
            issuer=normalized_issuer,
            subject=normalized_subject,
            user_id=user.id,
            source=link_source,
        )
        AuthSessionService(self.db).revoke_all_for_user_in_transaction(
            user,
            "external_identity_changed",
            increment_version=False,
        )
        commit_or_rollback(self.db)
        self.db.refresh(identity)
        return identity, True

    def has_alternate_primary_login(self, user: User, *, excluding_identity_id: str) -> bool:
        return self.queries.has_alternate_primary_login(
            user,
            excluding_identity_id=excluding_identity_id,
        )

    def _get_or_create(
        self,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: Optional[str],
        email_verified: bool,
        full_name: Optional[str],
        picture_url: Optional[str],
        linking_policy: str,
        trusted_email_domains: list[str],
        browser_secret_hash: Optional[str],
        redirect_path: Optional[str],
    ) -> tuple[User, bool]:
        provider_key = normalize_identity_provider_id(provider_id)
        normalized_issuer = normalize_oidc_issuer(issuer) if provider_type == "oidc" else None
        normalized_subject = str(subject or "").strip()
        if not normalized_subject:
            raise ValueError("External subject is required")
        normalized_email = normalize_optional_email(email)
        identity = self._find_mapping(
            provider_type,
            provider_key,
            normalized_subject,
            issuer=normalized_issuer,
            include_revoked=True,
        )
        if identity and identity.revoked_at is not None:
            raise ValueError("External identity has been revoked")
        if identity:
            return self._reuse_identity_mapping(
                identity,
                full_name=full_name,
                picture_url=picture_url,
            ), False

        if normalized_email:
            existing = self._resolve_existing_email_user(
                provider_type=provider_type,
                provider_id=provider_key,
                issuer=normalized_issuer,
                subject=normalized_subject,
                email=normalized_email,
                email_verified=email_verified,
                full_name=full_name,
                picture_url=picture_url,
                linking_policy=linking_policy,
                trusted_email_domains=trusted_email_domains,
                browser_secret_hash=browser_secret_hash,
                redirect_path=redirect_path,
            )
            if existing is not None:
                return existing, False

        return self._create_jit_identity_user(
            provider_type=provider_type,
            provider_id=provider_key,
            issuer=normalized_issuer,
            subject=normalized_subject,
            email=normalized_email,
            email_verified=email_verified,
            full_name=full_name,
            picture_url=picture_url,
        ), True

    def _reuse_identity_mapping(
        self,
        identity: ExternalIdentity,
        *,
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> User:
        user = self.db.get(User, identity.user_id)
        if not user:
            raise ValueError("External identity target does not exist")
        identity.last_login_at = utcnow()
        if picture_url and user.picture_url != picture_url:
            user.picture_url = picture_url
        if full_name and not user.full_name:
            user.full_name = full_name
        self.db.add_all([identity, user])
        commit_or_rollback(self.db)
        self.db.refresh(user)
        return user

    def _resolve_existing_email_user(
        self,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: str,
        email_verified: bool,
        full_name: Optional[str],
        picture_url: Optional[str],
        linking_policy: str,
        trusted_email_domains: list[str],
        browser_secret_hash: Optional[str],
        redirect_path: Optional[str],
    ) -> User | None:
        candidates = self._find_email_candidates(email)
        if len(candidates) > 1:
            raise ValueError("External identity email matches multiple users")
        if not candidates:
            return None

        existing = candidates[0]
        if provider_type == "oidc" and self._can_trust_email_link(
            existing,
            email,
            email_verified=email_verified,
            linking_policy=linking_policy,
            trusted_email_domains=trusted_email_domains,
        ):
            return self._link_trusted_email_identity(
                existing,
                provider_type=provider_type,
                provider_id=provider_id,
                issuer=issuer,
                subject=subject,
                email=email,
            )
        self._raise_existing_email_link_challenge(
            existing,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=email_verified,
            full_name=full_name,
            picture_url=picture_url,
            linking_policy=linking_policy,
            browser_secret_hash=browser_secret_hash,
            redirect_path=redirect_path,
        )

    def _link_trusted_email_identity(
        self,
        user: User,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: str,
    ) -> User:
        identity, _ = self.provision_identity(
            user=user,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=True,
            link_source="trusted_email",
        )
        AuditService(self.db).record_action(
            user=user,
            scope="security",
            action="external_identity_trusted_email_linked",
            entity_type="external_identity",
            entity_id=identity.id,
            metadata={"provider_type": provider_type, "provider_id": provider_id},
        )
        return user

    def _raise_existing_email_link_challenge(
        self,
        user: User,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: str,
        email_verified: bool,
        full_name: Optional[str],
        picture_url: Optional[str],
        linking_policy: str,
        browser_secret_hash: Optional[str],
        redirect_path: Optional[str],
    ) -> NoReturn:
        can_create_bound_attempt = bool(browser_secret_hash) and (
            provider_type == "ldap" or bool(issuer)
        )
        if can_create_bound_attempt:
            attempts = ExternalIdentityLinkAttemptService(self.db)
            attempt = attempts.create_login_collision_attempt(
                user=user,
                provider_type=provider_type,
                provider_id=provider_id,
                issuer=issuer,
                subject=subject,
                email=email,
                email_verified=email_verified,
                display_name=full_name,
                picture_url=picture_url,
                browser_secret_hash=browser_secret_hash,
                redirect_path=redirect_path,
            )
            if linking_policy != "reauthenticate":
                attempts.request_admin_approval(attempt.id, browser_secret_hash)
            raise ExternalIdentityReauthenticationRequiredError(attempt.id)

        if linking_policy == "reauthenticate":
            raise ValueError("External identity account linking browser binding is unavailable")

        request = self.request_link_approval(
            user=user,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=email_verified,
            request_source="login_collision",
            full_name=full_name,
            picture_url=picture_url,
        )
        raise ExternalIdentityLinkRequiredError(request.id)

    def _create_jit_identity_user(
        self,
        *,
        provider_type: str,
        provider_id: str,
        issuer: Optional[str],
        subject: str,
        email: Optional[str],
        email_verified: bool,
        full_name: Optional[str],
        picture_url: Optional[str],
    ) -> User:
        generated_email = email or self._generated_email(provider_type, provider_id, subject)
        user = User(
            email=generated_email,
            full_name=full_name,
            picture_url=picture_url,
            hashed_password=None,
            is_active=True,
            role=UserRole.UI_NONE.value,
            auth_version=1,
        )
        self.db.add(user)
        self.db.flush()
        identity = ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type=provider_type,
            provider_id=provider_id,
            issuer=issuer,
            subject=subject,
            email=email,
            email_verified=email_verified,
            created_at=utcnow(),
            link_source="jit",
        )
        self.db.add(identity)
        commit_or_rollback(self.db)
        self.db.refresh(user)
        return user

    def request_link_approval(
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
        return self.link_requests.request(
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
        )

    def _find_mapping(
        self,
        provider_type: str,
        provider_id: str,
        subject: str,
        *,
        issuer: Optional[str] = None,
        include_revoked: bool = False,
    ) -> ExternalIdentity | None:
        return self.queries.find_mapping(
            provider_type,
            provider_id,
            subject,
            issuer=issuer,
            include_revoked=include_revoked,
        )

    def _find_email_candidates(self, email: str) -> list[User]:
        return self.queries.find_email_candidates(email)

    def _can_trust_email_link(
        self,
        user: User,
        email: str,
        *,
        email_verified: bool,
        linking_policy: str,
        trusted_email_domains: list[str],
    ) -> bool:
        if linking_policy != "trusted_email" or not email_verified:
            return False
        domain = email.rsplit("@", 1)[1] if "@" in email else ""
        allowed = {str(item).strip().lower() for item in trusted_email_domains}
        if not domain or domain not in allowed:
            return False
        if not user.is_active or user.role not in {UserRole.UI_USER.value, UserRole.UI_NONE.value}:
            return False
        if not user.hashed_password:
            return False
        return self.db.scalar(
            select(ExternalIdentity.id)
            .where(ExternalIdentity.user_id == user.id)
            .limit(1)
        ) is None

    @staticmethod
    def _generated_email(provider_type: str, provider: str, subject: str) -> str:
        digest = hashlib.sha256(f"{provider_type}:{provider}:{subject}".encode()).hexdigest()[:16]
        return f"{provider_type}-{provider}-{digest}@identity.local"
