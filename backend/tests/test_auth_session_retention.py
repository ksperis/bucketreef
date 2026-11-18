# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.core.domain_enums import UserRole
from app.db import (
    AuthSession,
    BucketMigration,
    OpenStackCloud,
    OpenStackConnection,
    OpenStackSession,
    RefreshToken,
    User,
)
from app.services.auth_session_service import AuthSessionService
from app.utils.time import utcnow
from tests.db_transaction_test_utils import (
    fail_next_sqlite_statement_with_busy_snapshot,
    fail_next_transaction_commit,
)


def _user(db_session, email: str) -> User:
    user = User(
        email=email,
        full_name="Session Retention",
        hashed_password="hash",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _session(db_session, user: User, suffix: str) -> AuthSession:
    return AuthSessionService(db_session).create_for_user(
        user,
        auth_type="password",
        ip_address=f"192.0.2.{suffix}",
        user_agent="pytest-retention",
        mfa_verified=False,
    ).session


def _retention_service(db_session, days: int) -> AuthSessionService:
    service = AuthSessionService(db_session)
    service.settings = SimpleNamespace(auth_session_retention_days=days)
    return service


def test_purge_inactive_applies_terminal_timestamp_and_foreign_key_rules(db_session):
    user = _user(db_session, "session-retention@example.com")
    now = utcnow()
    old_revoked = _session(db_session, user, "41")
    recent_revoked = _session(db_session, user, "42")
    old_expired = _session(db_session, user, "43")

    old_revoked.revoked_at = now - timedelta(days=31)
    old_revoked.revoke_reason = "admin_revoke"
    recent_revoked.revoked_at = now - timedelta(days=29)
    recent_revoked.revoke_reason = "admin_revoke"
    old_expired.revoked_at = now
    old_expired.revoke_reason = "expired"
    old_expired.idle_expires_at = now - timedelta(days=31)

    cloud = OpenStackCloud(
        name="retention-cloud",
        auth_url="https://retention-cloud.example.test/v3",
    )
    db_session.add(cloud)
    db_session.flush()
    connection = OpenStackConnection(
        user_id=user.id,
        cloud_id=cloud.id,
        keystone_user_id="retention-user",
        display_name="Retention user",
    )
    db_session.add(connection)
    db_session.flush()
    openstack_session = OpenStackSession(
        connection_id=connection.id,
        auth_session_id=old_revoked.id,
        token=None,
        expires_at=now + timedelta(hours=1),
    )
    migration = BucketMigration(
        source_context_id="source-retention",
        target_context_id="target-retention",
        execution_auth_session_id=old_revoked.id,
    )
    db_session.add_all([openstack_session, migration, old_revoked, recent_revoked, old_expired])
    db_session.commit()
    old_revoked_id = old_revoked.id
    recent_revoked_id = recent_revoked.id
    old_expired_id = old_expired.id
    openstack_session_id = openstack_session.id
    old_refresh_tokens = db_session.scalar(
        select(func.count()).select_from(RefreshToken).where(RefreshToken.auth_session_id == old_revoked_id)
    )
    assert old_refresh_tokens == 1

    result = _retention_service(db_session, 30).purge_inactive()

    assert result["retention_days"] == 30
    assert result["deleted"] == 2
    assert result["cutoff"] is not None
    assert db_session.get(AuthSession, old_revoked_id) is None
    assert db_session.get(AuthSession, old_expired_id) is None
    assert db_session.get(AuthSession, recent_revoked_id) is not None
    assert db_session.scalar(
        select(func.count()).select_from(RefreshToken).where(RefreshToken.auth_session_id == old_revoked_id)
    ) == 0
    assert db_session.get(OpenStackSession, openstack_session_id) is None
    db_session.refresh(migration)
    assert migration.execution_auth_session_id is None


def test_purge_inactive_zero_retention_preserves_sessions(db_session):
    user = _user(db_session, "session-retention-disabled@example.com")
    session = _session(db_session, user, "44")
    session.revoked_at = utcnow() - timedelta(days=365)
    session.revoke_reason = "admin_revoke"
    db_session.add(session)
    db_session.commit()

    result = _retention_service(db_session, 0).purge_inactive()

    assert result == {"retention_days": 0, "deleted": 0, "cutoff": None}
    assert db_session.get(AuthSession, session.id) is not None


def test_purge_inactive_rolls_back_on_commit_failure(db_session):
    user = _user(db_session, "session-retention-rollback@example.com")
    session = _session(db_session, user, "45")
    session.revoked_at = utcnow() - timedelta(days=31)
    session.revoke_reason = "admin_revoke"
    db_session.add(session)
    db_session.commit()

    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            _retention_service(db_session, 30).purge_inactive()

    db_session.expire_all()
    assert db_session.get(AuthSession, session.id) is not None


def test_purge_inactive_replays_sqlite_busy_snapshot(db_session):
    user = _user(db_session, "session-retention-retry@example.com")
    session = _session(db_session, user, "46")
    session.revoked_at = utcnow() - timedelta(days=31)
    session.revoke_reason = "admin_revoke"
    db_session.add(session)
    db_session.commit()
    session_id = session.id

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "DELETE FROM auth_sessions",
    ) as statements:
        result = _retention_service(db_session, 30).purge_inactive()

    assert result["deleted"] == 1
    assert len(statements) >= 2
    assert db_session.get(AuthSession, session_id) is None
