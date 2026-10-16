# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.db import AuditLog, S3Account, S3Connection, S3User, User, UserRole
from app.main import app
from app.routers.manager import activity as manager_activity_router
from app.services.s3_execution_context import S3ExecutionContext
from tests.s3_account_factory import make_s3_account


def _account(name: str, db_session=None) -> S3Account:
    values = {"name": name, "rgw_access_key": "AK", "rgw_secret_key": "SK"}
    if db_session is None:
        return S3Account(**values)
    account = make_s3_account(db_session, **values)
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _s3_user(name: str, db_session) -> S3User:
    endpoint_seed = make_s3_account(db_session, name=f"{name}-endpoint")
    user = S3User(
        name=name,
        rgw_user_uid=name,
        rgw_access_key="AK-S3U",
        rgw_secret_key="SK-S3U",
        storage_endpoint_id=endpoint_seed.storage_endpoint_id,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _connection(name: str, db_session, *, shared: bool = True) -> S3Connection:
    endpoint_seed = make_s3_account(db_session, name=f"{name}-endpoint")
    owner = User(
        email=f"{name}@example.test",
        full_name=name,
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add(owner)
    db_session.flush()
    connection = S3Connection(
        created_by_user_id=owner.id,
        name=name,
        is_shared=shared,
        is_active=True,
        access_manager=True,
        access_browser=False,
        storage_endpoint_id=endpoint_seed.storage_endpoint_id,
        access_key_id="AK-CONNECTION",
        secret_access_key="SK-CONNECTION",
    )
    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)
    return connection


def _audit_log(
    *,
    context: S3ExecutionContext,
    action: str,
    scope: str = "manager",
    entity_type: str = "bucket",
    entity_id: str = "research-data",
    status: str = "success",
) -> AuditLog:
    return AuditLog(
        user_email="manager@example.com",
        user_role="ui_user",
        scope=scope,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        context_kind=context.context_kind,
        context_id=context.context_id,
        context_name=context.name,
        status=status,
        metadata_json='{"secret":"hidden"}',
        request_id="req-hidden",
        ip_address="192.0.2.10",
        user_agent="hidden-agent",
    )


def _context(resource: S3Account | S3User | S3Connection) -> S3ExecutionContext:
    if isinstance(resource, S3Account):
        return S3ExecutionContext.from_account(resource)
    if isinstance(resource, S3User):
        return S3ExecutionContext.from_s3_user(resource)
    return S3ExecutionContext.from_connection(resource)


def test_manager_activity_filters_audit_logs_to_exact_execution_context(client, db_session):
    account = _account("account-a", db_session)
    other_account = _account("account-b", db_session)
    context = _context(account)
    other_context = _context(other_account)

    expected = _audit_log(context=context, action="create_bucket", entity_id="bucket-a")
    other_scope = _audit_log(context=context, action="auth.login", scope="admin", entity_id="admin-event")
    other = _audit_log(context=other_context, action="create_bucket", entity_id="bucket-b")
    db_session.add_all([expected, other_scope, other])
    db_session.commit()

    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: context

    response = client.get("/api/manager/activity")

    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    entry = response.json()[0]
    assert entry["id"] == expected.id
    assert entry["created_at"]
    assert entry["action"] == "create_bucket"
    assert entry["entity_type"] == "bucket"
    assert entry["entity_id"] == "bucket-a"
    assert entry["context_kind"] == "account"
    assert entry["context_id"] == str(account.id)
    assert entry["context_name"] == "account-a"
    assert entry["status"] == "success"
    assert entry["user_email"] == "manager@example.com"


@pytest.mark.parametrize("resource_kind", ["s3_user", "connection"])
def test_manager_activity_supports_non_account_manager_contexts(client, db_session, resource_kind):
    resource = (
        _s3_user("activity-user", db_session)
        if resource_kind == "s3_user"
        else _connection("activity-shared", db_session)
    )
    context = _context(resource)
    expected = _audit_log(context=context, action="update_bucket_versioning")
    account = _account(f"other-{resource_kind}", db_session)
    other = _audit_log(context=_context(account), action="delete_bucket")
    db_session.add_all([expected, other])
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: context

    response = client.get("/api/manager/activity")

    assert response.status_code == 200, response.text
    assert [entry["id"] for entry in response.json()] == [expected.id]
    assert response.json()[0]["context_kind"] == resource_kind
    assert response.json()[0]["context_id"] == context.context_id


def test_manager_activity_does_not_expose_sensitive_audit_fields(client, db_session):
    account = _account("account-sensitive", db_session)
    context = _context(account)
    log = _audit_log(context=context, action="put_bucket_policy")
    db_session.add(log)
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: context

    response = client.get("/api/manager/activity")

    assert response.status_code == 200, response.text
    entry = response.json()[0]
    assert "metadata" not in entry
    assert "request_id" not in entry
    assert "ip_address" not in entry
    assert "user_agent" not in entry


def test_manager_activity_rejects_limits_above_twenty(client, db_session):
    account = _account("account-limit", db_session)
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: _context(account)

    response = client.get("/api/manager/activity?limit=21")

    assert response.status_code == 422, response.text


def test_manager_activity_rejects_unsaved_account_context(client):
    account = _account("transient-account")
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: _context(account)

    response = client.get("/api/manager/activity")

    assert response.status_code == 404, response.text


def test_manager_activity_is_unavailable_for_private_connection(client, db_session):
    connection = _connection("private-connection", db_session, shared=False)
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: _context(connection)

    response = client.get("/api/manager/activity")

    assert response.status_code == 404, response.text


@pytest.mark.parametrize("resource_kind", ["account", "s3_user", "connection"])
def test_manager_activity_respects_resource_override(client, db_session, resource_kind):
    if resource_kind == "account":
        resource = _account("activity-disabled-account", db_session)
    elif resource_kind == "s3_user":
        resource = _s3_user("activity-disabled-user", db_session)
    else:
        resource = _connection("activity-disabled-connection", db_session)
    resource.allow_activity_history = False
    db_session.add(resource)
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: _context(resource)

    response = client.get("/api/manager/activity")

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Activity history is disabled for this Manager context"


def test_manager_activity_supports_cursor_search_and_status_without_hidden_field_search(client, db_session):
    account = _account("account-search", db_session)
    context = _context(account)
    first = _audit_log(context=context, action="create_bucket", entity_id="archive", status="success")
    second = _audit_log(context=context, action="put_bucket_policy", entity_id="research-data", status="failure")
    third = _audit_log(context=context, action="delete_bucket", entity_id="temporary", status="success")
    db_session.add_all([first, second, third])
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: context

    response = client.get("/api/manager/activity?search=research&status=failure")
    assert response.status_code == 200, response.text
    assert [entry["id"] for entry in response.json()] == [second.id]

    response = client.get(f"/api/manager/activity?cursor={third.id}&limit=20")
    assert response.status_code == 200, response.text
    assert [entry["id"] for entry in response.json()] == [second.id, first.id]

    response = client.get("/api/manager/activity?search=hidden")
    assert response.status_code == 200, response.text
    assert response.json() == []

    response = client.get("/api/manager/activity?search=manager@example.com")
    assert response.status_code == 200, response.text
    assert [entry["id"] for entry in response.json()] == [third.id, second.id, first.id]


def test_manager_activity_filters_canonical_failure_status(client, db_session):
    account = _account("account-failures", db_session)
    context = _context(account)
    failure = _audit_log(context=context, action="first_failure", entity_id="one", status="failure")
    success = _audit_log(context=context, action="success", entity_id="two", status="success")
    db_session.add_all([failure, success])
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: context

    response = client.get("/api/manager/activity?status=failure&limit=20")

    assert response.status_code == 200, response.text
    assert [entry["id"] for entry in response.json()] == [failure.id]


def test_manager_activity_rejects_legacy_audit_status_alias(client, db_session):
    account = _account("account-legacy-status", db_session)
    app.dependency_overrides[manager_activity_router.get_s3_execution_context] = lambda: _context(account)

    response = client.get("/api/manager/activity?status=failed")

    assert response.status_code == 422, response.text
