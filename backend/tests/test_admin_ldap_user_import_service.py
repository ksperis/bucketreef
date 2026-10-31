# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.core.security import create_ldap_import_selection_token
from app.db import ApiToken, AuthSession, ExternalIdentity, User, UserRole
from app.models.admin_ldap_import import LDAPImportRequest
from app.services.admin_ldap_user_import_service import AdminLdapUserImportService
from app.services.ldap_service import LDAPIdentity
from app.services.users_service import get_users_service


class FakeLdapService:
    def __init__(self, identity: LDAPIdentity) -> None:
        self.identity = identity
        self.calls: list[tuple[str, str, str]] = []

    def reread_import_identity(self, provider_id: str, *, dn: str, subject: str) -> LDAPIdentity:
        self.calls.append((provider_id, dn, subject))
        return self.identity


def _actor(db_session) -> User:
    user = User(
        email="admin@example.test",
        full_name="Admin",
        hashed_password="admin-password-hash",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
        auth_version=3,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _identity() -> LDAPIdentity:
    return LDAPIdentity(
        provider="corp",
        subject="uuid-jane",
        dn="uid=jane,ou=people,dc=example,dc=test",
        email="jane.directory@example.test",
        full_name="Jane Directory",
    )


def _selection(actor: User, session_id: str, identity: LDAPIdentity) -> str:
    return create_ldap_import_selection_token(
        user_id=int(actor.id),
        session_id=session_id,
        auth_version=int(actor.auth_version),
        provider_id=identity.provider,
        subject=identity.subject,
        dn=identity.dn,
    )


def _service(db_session, identity: LDAPIdentity) -> AdminLdapUserImportService:
    return AdminLdapUserImportService(
        db_session,
        FakeLdapService(identity),
        get_users_service(db_session),
    )


def test_create_ldap_user_creates_passwordless_user_and_identity_atomically(db_session):
    actor = _actor(db_session)
    identity = _identity()
    session = SimpleNamespace(id="admin-session")
    service = _service(db_session, identity)
    request = LDAPImportRequest.model_validate(
        {
            "selection_token": _selection(actor, session.id, identity),
            "action": "create",
            "create": {
                "email": "jane.profile@example.com",
                "full_name": "Jane Profile",
                "role": "ui_user",
                "browser_advanced_features_enabled": True,
            },
        }
    )

    created, provider_id = service.import_user(request, actor=actor, session=session)

    assert provider_id == "corp"
    assert created.email == "jane.profile@example.com"
    assert created.full_name == "Jane Profile"
    assert created.hashed_password is None
    assert created.browser_advanced_features_enabled is True
    mapping = db_session.scalars(select(ExternalIdentity).where(ExternalIdentity.user_id == created.id)).one()
    assert mapping.provider_type == "ldap"
    assert mapping.provider_id == "corp"
    assert mapping.subject == "uuid-jane"
    assert mapping.email == "jane.directory@example.test"
    assert mapping.link_source == "administrator"


def test_link_ldap_identity_preserves_target_and_revokes_credentials(db_session):
    actor = _actor(db_session)
    target = User(
        email="existing@example.test",
        full_name="Existing Profile",
        hashed_password="existing-password-hash",
        is_active=False,
        role=UserRole.UI_ADMIN.value,
        auth_version=7,
        can_access_ceph_admin=True,
    )
    db_session.add(target)
    db_session.flush()
    auth_session = AuthSession(
        id="target-session",
        user_id=target.id,
        principal_type="user",
        auth_type="ui",
        auth_version=target.auth_version,
        last_activity_at=datetime(2026, 10, 31, tzinfo=UTC),
        idle_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        absolute_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        csrf_token_hash="csrf-target",
    )
    api_token = ApiToken(
        id="target-token",
        jti="target-jti",
        token_hash="target-hash",
        user_id=target.id,
        name="target token",
        auth_version=target.auth_version,
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    db_session.add_all([auth_session, api_token])
    db_session.commit()
    original = (target.email, target.full_name, target.hashed_password, target.is_active, target.role, target.can_access_ceph_admin)
    identity = _identity()
    session = SimpleNamespace(id="admin-session")
    service = _service(db_session, identity)
    request = LDAPImportRequest(
        selection_token=_selection(actor, session.id, identity),
        action="link",
        target_user_id=target.id,
    )

    linked, _ = service.import_user(request, actor=actor, session=session)

    assert (linked.email, linked.full_name, linked.hashed_password, linked.is_active, linked.role, linked.can_access_ceph_admin) == original
    assert linked.auth_version == 8
    mapping = db_session.scalars(select(ExternalIdentity).where(ExternalIdentity.user_id == target.id)).one()
    assert mapping.subject == "uuid-jane"
    assert mapping.revoked_at is None
    db_session.refresh(auth_session)
    db_session.refresh(api_token)
    assert auth_session.revoked_at is not None
    assert auth_session.revoke_reason == "external_identity_changed"
    assert api_token.revoked_at is not None


def test_restore_requires_original_owner_and_revokes_credentials(db_session):
    actor = _actor(db_session)
    target = User(
        email="existing@example.test",
        hashed_password="existing-password-hash",
        is_active=True,
        role=UserRole.UI_USER.value,
        auth_version=2,
    )
    other = User(
        email="other@example.test",
        hashed_password="other-password-hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([target, other])
    db_session.flush()
    identity = _identity()
    mapping = ExternalIdentity(
        id="revoked-identity",
        user_id=target.id,
        provider_type="ldap",
        provider_id=identity.provider,
        issuer=None,
        subject=identity.subject,
        email=identity.email,
        email_verified=False,
        link_source="administrator",
        revoked_at=datetime(2026, 10, 30, tzinfo=UTC),
    )
    auth_session = AuthSession(
        id="restore-target-session",
        user_id=target.id,
        principal_type="user",
        auth_type="ui",
        auth_version=target.auth_version,
        last_activity_at=datetime(2026, 10, 31, tzinfo=UTC),
        idle_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        absolute_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        csrf_token_hash="csrf-restore",
    )
    db_session.add_all([mapping, auth_session])
    db_session.commit()
    session = SimpleNamespace(id="admin-session")
    service = _service(db_session, identity)

    wrong_owner = LDAPImportRequest(
        selection_token=_selection(actor, session.id, identity),
        action="restore",
        target_user_id=other.id,
    )
    with pytest.raises(ValueError, match="belongs to another UI user"):
        service.import_user(wrong_owner, actor=actor, session=session)

    restored, _ = service.import_user(
        LDAPImportRequest(
            selection_token=_selection(actor, session.id, identity),
            action="restore",
            target_user_id=target.id,
        ),
        actor=actor,
        session=session,
    )

    assert restored.auth_version == 3
    db_session.refresh(mapping)
    db_session.refresh(auth_session)
    assert mapping.revoked_at is None
    assert auth_session.revoked_at is not None
    assert auth_session.revoke_reason == "external_identity_restored"


def test_selection_token_is_bound_to_actor_session_and_auth_version(db_session):
    actor = _actor(db_session)
    identity = _identity()
    token = _selection(actor, "session-a", identity)

    request = LDAPImportRequest(
        selection_token=token,
        action="link",
        target_user_id=actor.id,
    )

    with pytest.raises(ValueError, match="current administrator session"):
        AdminLdapUserImportService._selection_claims(
            request,
            actor=actor,
            session=SimpleNamespace(id="session-b"),
        )

    actor.auth_version += 1
    with pytest.raises(ValueError, match="current administrator session"):
        AdminLdapUserImportService._selection_claims(
            request,
            actor=actor,
            session=SimpleNamespace(id="session-a"),
        )
