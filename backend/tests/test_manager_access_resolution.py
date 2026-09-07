# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta
import json
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.db import (
    BucketMigration,
    BucketMigrationEvent,
    ManagerAccountRole,
    PortalAccountRole,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.models.app_settings import AppSettings
from app.main import app
from app.routers import dependencies
from app.routers.dependencies_internal import feature_gates
from app.services.bucket_migration_service import BucketMigrationService
from app.services.effective_access_service import EffectiveAccessService
from app.utils.time import utcnow
from tests.s3_account_factory import make_s3_account


_TOOL_GATES = [
    ("bucket_compare", feature_gates.require_bucket_compare_enabled),
    ("bucket_integrity_check", feature_gates.require_bucket_integrity_check_enabled),
    ("bucket_migration", feature_gates.get_current_bucket_migration_scope),
    ("feature_rules", feature_gates.require_manager_feature_rules_enabled),
    ("bucket_purge", feature_gates.require_bucket_purge_enabled),
]


@pytest.fixture
def principal(db_session, monkeypatch):
    settings = AppSettings()
    for tool, _ in _TOOL_GATES:
        if tool != "feature_rules":
            setattr(settings.general, f"{tool}_enabled", True)
    monkeypatch.setattr(feature_gates.app_settings_service, "load_app_settings", lambda: settings)
    user = User(email="scope@example.test", hashed_password="x", is_active=True, role=UserRole.UI_USER.value)
    group = UiGroup(name="Migration operators", can_access_manager_bucket_migration=True)
    membership = UserUiGroup(user=user, group=group)
    db_session.add(membership)
    db_session.commit()
    return user, group, membership


@pytest.mark.parametrize("tool,gate", _TOOL_GATES)
@pytest.mark.parametrize("role", [UserRole.UI_USER.value, UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value])
@pytest.mark.parametrize("grant", ["direct", "group"])
def test_tool_gates_resolve_direct_and_group_access(db_session, principal, tool, gate, role, grant):
    user, group, _ = principal
    user.role = role
    field = f"can_access_manager_{tool}"
    setattr(user, field, grant == "direct")
    setattr(group, field, grant == "group")
    db_session.commit()

    result = gate(user=user, db=db_session)

    assert (result.user if tool == "bucket_migration" else result) is user


@pytest.mark.parametrize("tool,gate", _TOOL_GATES)
def test_tool_gates_revalidate_group_revocation(db_session, principal, tool, gate):
    user, group, membership = principal
    setattr(group, f"can_access_manager_{tool}", True)
    db_session.commit()
    gate(user=user, db=db_session)

    db_session.delete(membership)
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        gate(user=user, db=db_session)
    assert exc.value.status_code == 403
    assert exc.value.detail == "Not authorized"


@pytest.mark.parametrize("tool,gate", _TOOL_GATES)
def test_tool_gates_reject_unassigned_role_before_resolving_access(db_session, principal, tool, gate):
    user, group, _ = principal
    user.role = UserRole.UI_NONE.value
    setattr(user, f"can_access_manager_{tool}", True)
    setattr(group, f"can_access_manager_{tool}", True)
    db_session.commit()

    with patch.object(EffectiveAccessService, "resolve_user") as resolve:
        with pytest.raises(HTTPException) as exc:
            gate(user=user, db=db_session)
    assert exc.value.status_code == 403
    resolve.assert_not_called()


@pytest.mark.parametrize("tool,gate", [entry for entry in _TOOL_GATES if entry[0] != "feature_rules"])
def test_tool_gates_reject_disabled_feature_before_resolving_access(db_session, principal, tool, gate):
    user, _, _ = principal
    setattr(feature_gates.app_settings_service.load_app_settings().general, f"{tool}_enabled", False)

    with patch.object(EffectiveAccessService, "resolve_user") as resolve:
        with pytest.raises(HTTPException) as exc:
            gate(user=user, db=db_session)
    assert exc.value.status_code == 403
    assert "feature is disabled" in exc.value.detail.lower()
    resolve.assert_not_called()


def _connection(db_session, user, *, name="connection", **values):
    connection = S3Connection(
        created_by_user_id=user.id,
        name=name,
        access_manager=True,
        access_key_id="test-access-key",
        secret_access_key="test-secret-key",
        custom_endpoint_config=json.dumps({
            "endpoint_url": "https://s3.example.test", "region": None,
            "provider": None, "force_path_style": False, "verify_tls": True,
        }),
        **values,
    )
    db_session.add(connection)
    db_session.flush()
    return connection


@pytest.mark.parametrize("grant", ["direct", "group"])
def test_migration_scope_and_worker_share_exact_manager_contexts(db_session, principal, grant):
    user, group, _ = principal
    account = make_s3_account(db_session, name="manager-account")
    portal_account = make_s3_account(db_session, name="portal-account")
    rgw_user = S3User(
        name="rgw-user", rgw_user_uid="rgw-user", rgw_access_key="test-key", rgw_secret_key="test-secret",
        storage_endpoint_id=account.storage_endpoint_id,
    )
    db_session.add_all([account, portal_account, rgw_user])
    shared = _connection(db_session, user, name="shared", is_shared=True)
    private = _connection(db_session, user, name="private", is_shared=False)
    if grant == "direct":
        account_link_type, user_link_type, connection_link_type = UserS3Account, UserS3User, UserS3Connection
        owner = {"user_id": user.id}
    else:
        account_link_type, user_link_type, connection_link_type = UiGroupS3Account, UiGroupS3User, UiGroupS3Connection
        owner = {"group_id": group.id}
    db_session.add_all([
        account_link_type(**owner, account_id=account.id, manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value),
        account_link_type(**owner, account_id=portal_account.id, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
        user_link_type(**owner, s3_user_id=rgw_user.id),
        connection_link_type(**owner, s3_connection_id=shared.id),
    ])
    db_session.commit()

    scope = feature_gates.get_current_bucket_migration_scope(user=user, db=db_session)
    expected = {str(account.id), f"s3u-{rgw_user.id}", f"conn-{shared.id}", f"conn-{private.id}"}
    assert scope.allowed_context_ids == expected
    assert scope.admin_account_context_ids == {str(account.id)}
    migration = BucketMigration(created_by_user_id=user.id)
    worker = BucketMigrationService(db_session)
    assert worker._creator_allowed_context_ids(migration) == expected
    scope.allowed_context_ids.clear()
    assert scope.admin_account_context_ids == {str(account.id)}


@pytest.mark.parametrize("rejection", ["inactive", "expired", "remediation", "browser_only", "foreign_private", "unassigned_shared"])
def test_migration_scope_excludes_ineligible_connections(db_session, principal, rejection):
    user, _, _ = principal
    other = User(email="other@example.test", hashed_password="x", is_active=True, role=UserRole.UI_USER.value)
    db_session.add(other)
    db_session.flush()
    connection = _connection(db_session, other if rejection == "foreign_private" else user)
    if rejection == "inactive":
        connection.is_active = False
    elif rejection == "expired":
        connection.expires_at = utcnow() - timedelta(seconds=1)
    elif rejection == "remediation":
        connection.remediation_required = True
    elif rejection == "browser_only":
        connection.access_manager = False
        connection.access_browser = True
    elif rejection == "unassigned_shared":
        connection.is_shared = True
    db_session.commit()

    scope = feature_gates.get_current_bucket_migration_scope(user=user, db=db_session)

    assert scope.allowed_context_ids == set()
    assert scope.admin_account_context_ids == set()
    assert BucketMigrationService(db_session)._creator_allowed_context_ids(BucketMigration(created_by_user_id=user.id)) == set()


@pytest.mark.parametrize("revocation", ["group_link", "connection_expired", "user_disabled"])
def test_migration_worker_revalidates_and_records_revocation(db_session, principal, revocation):
    user, group, membership = principal
    connection = _connection(db_session, user, is_shared=True)
    db_session.add(UiGroupS3Connection(group_id=group.id, s3_connection_id=connection.id))
    migration = BucketMigration(
        created_by_user_id=user.id,
        source_context_id=f"conn-{connection.id}",
        target_context_id=f"conn-{connection.id}",
        status="running",
    )
    db_session.add(migration)
    db_session.commit()
    worker = BucketMigrationService(db_session)
    worker._assert_migration_creator_access(migration)

    if revocation == "group_link":
        db_session.delete(membership)
    elif revocation == "connection_expired":
        connection.expires_at = utcnow() - timedelta(seconds=1)
    else:
        user.is_active = False
    db_session.commit()

    with pytest.raises(PermissionError, match="creator access has been revoked"):
        worker._assert_migration_creator_access(migration)

    db_session.refresh(migration)
    assert migration.status == "failed"
    assert migration.finished_at is not None
    event = db_session.query(BucketMigrationEvent).filter_by(migration_id=migration.id).one()
    assert event.level == "error"
    assert json.loads(event.metadata_json) == {"revoked_context_ids": [f"conn-{connection.id}"]}


def test_migration_api_resolves_group_grants_and_observes_revocation(client, db_session, principal, monkeypatch):
    user, group, _ = principal
    connection = _connection(db_session, user, is_shared=True)
    grant = UiGroupS3Connection(group_id=group.id, s3_connection_id=connection.id)
    migration = BucketMigration(
        created_by_user_id=user.id,
        source_context_id=f"conn-{connection.id}",
        target_context_id=f"conn-{connection.id}",
    )
    db_session.add_all([grant, migration])
    db_session.commit()
    monkeypatch.setitem(app.dependency_overrides, dependencies.get_current_user, lambda: user)
    resolve_user = EffectiveAccessService.resolve_user

    with patch.object(EffectiveAccessService, "resolve_user", autospec=True, side_effect=resolve_user) as resolve:
        allowed = client.get("/api/manager/migrations")
        assert allowed.status_code == 200
        assert [item["id"] for item in allowed.json()["items"]] == [migration.id]
        assert resolve.call_count == 1

        db_session.delete(grant)
        db_session.commit()
        hidden = client.get("/api/manager/migrations")
        assert hidden.status_code == 200
        assert hidden.json()["items"] == []
        assert resolve.call_count == 2

        group.can_access_manager_bucket_migration = False
        db_session.commit()
        denied = client.get("/api/manager/migrations")
        assert denied.status_code == 403
        assert denied.json()["detail"] == "Not authorized"
        assert resolve.call_count == 3
