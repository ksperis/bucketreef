# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import (
    AuthSession,
    ExternalIdentity,
    ExternalIdentityLinkRequest,
    User,
    WebAuthnCredential,
    is_superadmin_ui_role,
)
from app.models.auth import SessionInfo
from app.models.identity_security import (
    AdminExternalIdentityInfo,
    AdminPasskeyInfo,
    AdminSessionInfo,
    AdminUserSecurity,
    ExternalIdentityLinkRequestInfo,
)
from app.services.auth_session_service import AuthSessionService
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.identity_security_policy import (
    STANDARD_UI_ROLES,
    ensure_actor_can_manage_user,
    passkey_required_for_role,
)
from app.services.users_service import UsersService


class AdminIdentitySecurityService:
    """Read and authorize administrator identity-security targets."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UsersService(db)
        self.sessions = AuthSessionService(db)
        self.identities = ExternalIdentityUserService(db)

    @staticmethod
    def session_info(row: AuthSession) -> SessionInfo:
        return SessionInfo(
            id=row.id,
            principal_type=row.principal_type,
            auth_type=row.auth_type,
            created_at=row.created_at,
            last_activity_at=row.last_activity_at,
            idle_expires_at=row.idle_expires_at,
            absolute_expires_at=row.absolute_expires_at,
            mfa_verified_at=row.mfa_verified_at,
            ip_address=row.ip_address,
            user_agent=row.user_agent,
            revoked_at=row.revoked_at,
            revoke_reason=row.revoke_reason,
            user_id=row.user_id,
            s3_session_id=row.s3_session_id,
        )

    @staticmethod
    def external_identity_info(row: ExternalIdentity) -> AdminExternalIdentityInfo:
        return AdminExternalIdentityInfo(
            id=row.id,
            provider_type=row.provider_type,
            provider_id=row.provider_id,
            subject=row.subject,
            email=row.email,
            email_verified=bool(row.email_verified),
            link_source=row.link_source,
            created_at=row.created_at,
            last_login_at=row.last_login_at,
            revoked_at=row.revoked_at,
        )

    def managed_user(
        self,
        actor: User,
        user_id: int,
        *,
        allow_self: bool = True,
    ) -> User:
        target = self.users.get_by_id(user_id)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        ensure_actor_can_manage_user(actor, target, allow_self=allow_self)
        return target

    def _users_by_id(self, user_ids: set[int]) -> dict[int, User]:
        if not user_ids:
            return {}
        return {
            row.id: row
            for row in self.db.scalars(select(User).where(User.id.in_(user_ids))).all()
        }

    def user_security(
        self,
        actor: User,
        user_id: int,
        *,
        include_revoked: bool,
    ) -> AdminUserSecurity:
        target = self.managed_user(actor, user_id)
        passkeys = select(WebAuthnCredential).where(
            WebAuthnCredential.user_id == target.id
        )
        if not include_revoked:
            passkeys = passkeys.where(WebAuthnCredential.revoked_at.is_(None))
        passkey_rows = self.db.scalars(
            passkeys.order_by(WebAuthnCredential.created_at.asc())
        ).all()
        identities = self.identities.list_for_user(
            target.id,
            include_revoked=include_revoked,
        )
        sessions = self.sessions.list_for_user(target.id)
        return AdminUserSecurity(
            user_id=target.id,
            email=target.email,
            role=target.role,
            has_local_password=bool(target.hashed_password),
            passkey_required=passkey_required_for_role(self.db, target.role),
            passkeys=[
                AdminPasskeyInfo(
                    id=row.id,
                    name=row.name,
                    created_at=row.created_at,
                    last_used_at=row.last_used_at,
                    revoked_at=row.revoked_at,
                )
                for row in passkey_rows
            ],
            external_identities=[self.external_identity_info(row) for row in identities],
            sessions=[self.session_info(row) for row in sessions],
        )

    def managed_identity(
        self,
        actor: User,
        user_id: int,
        identity_id: str,
    ) -> tuple[User, ExternalIdentity]:
        target = self.managed_user(actor, user_id, allow_self=False)
        identity = self.db.execute(
            select(ExternalIdentity).where(
                ExternalIdentity.id == identity_id,
                ExternalIdentity.user_id == target.id,
            )
        ).scalar_one_or_none()
        if identity is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="External identity not found",
            )
        return target, identity

    def managed_user_session(
        self,
        actor: User,
        user_id: int,
        session_id: str,
    ) -> AuthSession:
        target = self.managed_user(actor, user_id)
        session = self.db.execute(
            select(AuthSession).where(
                AuthSession.id == session_id,
                AuthSession.user_id == target.id,
            )
        ).scalar_one_or_none()
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        return session

    def list_link_requests(
        self,
        actor: User,
        *,
        include_decided: bool,
    ) -> list[ExternalIdentityLinkRequestInfo]:
        rows = self.identities.list_link_requests(include_decided=include_decided)
        user_ids = {row.user_id for row in rows}
        users = self._users_by_id(user_ids)
        result: list[ExternalIdentityLinkRequestInfo] = []
        for row in rows:
            target = users.get(row.user_id)
            if target is None or (
                not is_superadmin_ui_role(actor.role)
                and target.role not in STANDARD_UI_ROLES
            ):
                continue
            result.append(
                ExternalIdentityLinkRequestInfo(
                    id=row.id,
                    user_id=target.id,
                    user_email=target.email,
                    user_role=target.role,
                    provider_type=row.provider_type,
                    provider_id=row.provider_id,
                    email=row.email,
                    status=row.status,
                    created_at=row.created_at,
                    expires_at=row.expires_at,
                    decided_at=row.decided_at,
                    decision_source=row.decision_source,
                )
            )
        return result

    def managed_link_request(
        self,
        actor: User,
        request_id: str,
    ) -> ExternalIdentityLinkRequest:
        link_request = self.db.execute(
            select(ExternalIdentityLinkRequest).where(
                ExternalIdentityLinkRequest.id == request_id
            )
        ).scalar_one_or_none()
        if link_request is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="External identity request not found",
            )
        self.managed_user(actor, link_request.user_id)
        return link_request

    def list_global_sessions(
        self,
        actor: User,
        *,
        include_revoked: bool,
    ) -> list[AdminSessionInfo]:
        rows = self.sessions.list_for_admin(actor, include_revoked=include_revoked)
        user_ids = {row.user_id for row in rows if row.user_id is not None}
        users = self._users_by_id(user_ids)
        return [
            AdminSessionInfo(
                **self.session_info(row).model_dump(),
                user_email=users[row.user_id].email if row.user_id in users else None,
                user_full_name=(
                    users[row.user_id].full_name if row.user_id in users else None
                ),
                user_role=users[row.user_id].role if row.user_id in users else None,
            )
            for row in rows
        ]

    def managed_global_session(self, actor: User, session_id: str) -> AuthSession:
        row = self.db.execute(
            select(AuthSession).where(AuthSession.id == session_id)
        ).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        if row.user_id is None:
            if not is_superadmin_ui_role(actor.role):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        else:
            self.managed_user(actor, row.user_id)
        return row
