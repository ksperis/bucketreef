# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.core.security import create_ldap_import_selection_token, decode_typed_token
from app.db import AuthSession, ExternalIdentity, User
from app.models.admin_ldap_import import (
    LDAPImportCreatePayload,
    LDAPImportMatchedUser,
    LDAPImportRequest,
    LDAPImportSearchItem,
    LDAPImportSearchResponse,
)
from app.services.auth_session_service import AuthSessionService
from app.services.ldap_service import LDAPAuthService, LDAPIdentity
from app.services.user_associations_service import UserAssociationsService
from app.services.user_provisioning_service import user_create_access_column_values
from app.services.users_service import UsersService
from app.utils.time import utcnow


class AdminLdapUserImportService:
    def __init__(self, db: Session, ldap: LDAPAuthService, users: UsersService) -> None:
        self.db = db
        self.ldap = ldap
        self.users = users

    @staticmethod
    def _matched_user(user: User | None) -> LDAPImportMatchedUser | None:
        if user is None:
            return None
        return LDAPImportMatchedUser(
            id=int(user.id),
            email=user.email,
            full_name=user.full_name,
            role=user.role,
        )

    def _identity_mapping(self, identity: LDAPIdentity) -> ExternalIdentity | None:
        return self.db.scalar(
            select(ExternalIdentity)
            .where(
                ExternalIdentity.provider_type == "ldap",
                ExternalIdentity.provider_id == identity.provider,
                ExternalIdentity.subject == identity.subject,
            )
            .limit(1)
        )

    def search(
        self,
        *,
        actor: User,
        session: AuthSession,
        provider_id: str,
        query: str,
    ) -> LDAPImportSearchResponse:
        identities, truncated = self.ldap.search_import_candidates(provider_id, query, limit=25)
        items: list[LDAPImportSearchItem] = []
        for identity in identities:
            mapping = self._identity_mapping(identity)
            linked_user = self.db.get(User, mapping.user_id) if mapping else None
            email_match = self.users.get_by_email_case_insensitive(identity.email) if identity.email else None
            if mapping and mapping.revoked_at is not None:
                state = "revoked"
            elif mapping:
                state = "linked"
            else:
                state = "available"
            items.append(
                LDAPImportSearchItem(
                    selection_token=create_ldap_import_selection_token(
                        user_id=int(actor.id),
                        session_id=session.id,
                        auth_version=int(actor.auth_version),
                        provider_id=identity.provider,
                        subject=identity.subject,
                        dn=identity.dn,
                    ),
                    provider_id=identity.provider,
                    email=identity.email,
                    full_name=identity.full_name,
                    directory_dn=identity.dn,
                    identity_state=state,
                    linked_user=self._matched_user(linked_user),
                    email_match_user=self._matched_user(email_match),
                )
            )
        return LDAPImportSearchResponse(items=items, truncated=truncated)

    @staticmethod
    def _selection_claims(
        request: LDAPImportRequest,
        *,
        actor: User,
        session: AuthSession,
    ) -> dict:
        claims = decode_typed_token(
            request.selection_token,
            expected_type="ldap_import_selection",
        )
        if claims is None:
            raise ValueError("LDAP import selection expired or is invalid; search again")
        if (
            claims.get("uid") != actor.id
            or claims.get("sid") != session.id
            or claims.get("auth_version") != actor.auth_version
        ):
            raise ValueError("LDAP import selection does not belong to the current administrator session")
        if not claims.get("provider_id") or not claims.get("ldap_subject") or not claims.get("ldap_dn"):
            raise ValueError("LDAP import selection is incomplete; search again")
        return claims

    def import_user(
        self,
        request: LDAPImportRequest,
        *,
        actor: User,
        session: AuthSession,
    ) -> tuple[User, str]:
        claims = self._selection_claims(request, actor=actor, session=session)
        identity = self.ldap.reread_import_identity(
            str(claims["provider_id"]),
            dn=str(claims["ldap_dn"]),
            subject=str(claims["ldap_subject"]),
        )
        mapping = self._identity_mapping(identity)
        try:
            if request.action == "create":
                if mapping is not None:
                    if mapping.revoked_at is not None:
                        raise ValueError("LDAP identity is revoked; explicitly restore its existing link")
                    raise ValueError("LDAP identity is already linked to a UI user")
                assert request.create is not None
                imported = self._create_user(identity, request.create)
            else:
                target = self.db.get(User, request.target_user_id)
                if target is None:
                    raise ValueError("Target UI user not found")
                if request.action == "restore":
                    imported = self._restore_identity(identity, target, mapping)
                else:
                    imported = self._link_identity(identity, target, mapping)
        except Exception:
            self.db.rollback()
            raise
        commit_or_rollback(self.db)
        self.db.refresh(imported)
        return imported, identity.provider

    def _create_user(self, identity: LDAPIdentity, payload: LDAPImportCreatePayload) -> User:
        email = str(payload.email).strip().lower()
        if self.users.get_by_email_case_insensitive(email):
            raise ValueError("A UI user with this email already exists; link the LDAP identity instead")
        role = payload.role
        user = User(
            email=email,
            full_name=(payload.full_name or "").strip() or None,
            hashed_password=None,
            is_active=True,
            role=role,
            **user_create_access_column_values(payload),
        )
        self.db.add(user)
        self.db.flush()

        external_identity = ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type="ldap",
            provider_id=identity.provider,
            issuer=None,
            subject=identity.subject,
            email=identity.email,
            email_verified=False,
            created_at=utcnow(),
            link_source="administrator",
        )
        self.db.add(external_identity)

        associations = UserAssociationsService(self.db)
        associations.apply_updates(user, payload)
        self.db.add(user)
        return user

    def _link_identity(
        self,
        identity: LDAPIdentity,
        target: User,
        mapping: ExternalIdentity | None,
    ) -> User:
        if mapping is not None:
            if mapping.revoked_at is not None:
                raise ValueError("LDAP identity is revoked; explicitly restore its existing link")
            if mapping.user_id == target.id:
                raise ValueError("LDAP identity is already linked to this UI user")
            raise ValueError("LDAP identity is already linked to another UI user")
        row = ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=target.id,
            provider_type="ldap",
            provider_id=identity.provider,
            issuer=None,
            subject=identity.subject,
            email=identity.email,
            email_verified=False,
            created_at=utcnow(),
            link_source="administrator",
        )
        target.auth_version += 1
        self.db.add_all([row, target])
        AuthSessionService(self.db).revoke_all_for_user_in_transaction(
            target,
            "external_identity_changed",
            increment_version=False,
        )
        return target

    def _restore_identity(
        self,
        identity: LDAPIdentity,
        target: User,
        mapping: ExternalIdentity | None,
    ) -> User:
        if mapping is None or mapping.revoked_at is None:
            raise ValueError("LDAP identity does not have a revoked link to restore")
        if mapping.user_id != target.id:
            raise ValueError("Revoked LDAP identity belongs to another UI user")
        mapping.revoked_at = None
        mapping.email = identity.email
        mapping.email_verified = False
        target.auth_version += 1
        self.db.add_all([mapping, target])
        AuthSessionService(self.db).revoke_all_for_user_in_transaction(
            target,
            "external_identity_restored",
            increment_version=False,
        )
        return target
