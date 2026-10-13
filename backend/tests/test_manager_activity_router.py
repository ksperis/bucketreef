# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import AuditLog, S3Account
from app.main import app
from app.routers.manager import activity as manager_activity_router
from app.services.s3_execution_context import S3ExecutionContext
from tests.s3_account_factory import make_s3_account


def _account(name: str, db_session=None) -> S3Account:
    values = {"name": name, "rgw_access_key": "AK", "rgw_secret_key": "SK"}
    if db_session is None:
        return S3Account(**values)
    return make_s3_account(db_session, **values)


def _audit_log(
    *,
    account: S3Account,
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
        account_id=account.id,
        account_name=account.name,
        status=status,
        metadata_json='{"secret":"hidden"}',
        request_id="req-hidden",
        ip_address="192.0.2.10",
        user_agent="hidden-agent",
    )


def _context(account: S3Account) -> S3ExecutionContext:
    return S3ExecutionContext.from_account(account)


def test_manager_activity_filters_audit_logs_to_current_account(client, db_session):
    account = _account("account-a", db_session)
    other_account = _account("account-b", db_session)
    db_session.add_all([account, other_account])
    db_session.commit()

    expected = _audit_log(account=account, action="create_bucket", entity_id="bucket-a")
    other_scope = _audit_log(account=account, action="auth.login", scope="admin", entity_id="admin-event")
    other_context = _audit_log(account=other_account, action="create_bucket", entity_id="bucket-b")
    db_session.add_all([expected, other_scope, other_context])
    db_session.commit()

    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: _context(account)

    response = client.get("/api/manager/activity")

    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    entry = response.json()[0]
    assert entry["id"] == expected.id
    assert entry["created_at"]
    assert entry["action"] == "create_bucket"
    assert entry["entity_type"] == "bucket"
    assert entry["entity_id"] == "bucket-a"
    assert entry["account_id"] == account.id
    assert entry["account_name"] == "account-a"
    assert entry["status"] == "success"
    assert entry["user_email"] == "manager@example.com"


def test_manager_activity_does_not_expose_sensitive_audit_fields(client, db_session):
    account = _account("account-a", db_session)
    db_session.add(account)
    db_session.commit()
    log = _audit_log(account=account, action="put_bucket_policy")
    db_session.add(log)
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: _context(account)

    response = client.get("/api/manager/activity")

    assert response.status_code == 200, response.text
    entry = response.json()[0]
    assert "metadata" not in entry
    assert "request_id" not in entry
    assert "ip_address" not in entry
    assert "user_agent" not in entry


def test_manager_activity_rejects_limits_above_twenty(client, db_session):
    account = _account("account-a", db_session)
    db_session.add(account)
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: _context(account)

    response = client.get("/api/manager/activity?limit=21")

    assert response.status_code == 422, response.text


def test_manager_activity_rejects_unsaved_account_context(client):
    account = _account("transient-account")
    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: _context(account)

    response = client.get("/api/manager/activity")

    assert response.status_code == 404, response.text


def test_manager_activity_is_unavailable_for_non_account_context(client):
    context = S3ExecutionContext(
        context_id="s3u-1",
        context_kind="s3_user",
        name="managed-user",
        access_key="AK",
        secret_key="SK",
    )
    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: context

    response = client.get("/api/manager/activity")

    assert response.status_code == 404, response.text


def test_manager_activity_respects_account_override(client, db_session):
    account = _account("activity-disabled", db_session)
    account.allow_activity_history = False
    db_session.add(account)
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: _context(account)

    response = client.get("/api/manager/activity")

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Activity history is disabled for this RGW Account"


def test_manager_activity_supports_cursor_search_and_status_without_hidden_field_search(client, db_session):
    account = _account("account-search", db_session)
    db_session.add(account)
    db_session.commit()
    first = _audit_log(account=account, action="create_bucket", entity_id="archive", status="success")
    second = _audit_log(account=account, action="put_bucket_policy", entity_id="research-data", status="failure")
    third = _audit_log(account=account, action="delete_bucket", entity_id="temporary", status="success")
    db_session.add_all([first, second, third])
    db_session.commit()
    app.dependency_overrides[manager_activity_router.get_account_context] = lambda: _context(account)

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
