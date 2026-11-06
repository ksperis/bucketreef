# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

import pytest
from sqlalchemy import func, select

from app.main import app
from app.db import AuditLog, S3Account, User
from app.core.domain_enums import UserRole
from app.models.audit import AuditLogEntry, AuditLogListingRequest, AuditLogListResponse
from app.models.session import SessionCapabilities
from app.services.access_context_contracts import ManagerSessionPrincipal
from app.services.audit_policy import (
    DATA_PLANE_AUDIT_ACTIONS,
    NON_AUDIT_OPERATION_ACTIONS,
    should_persist_audit_action,
)
from app.services.audit_service import (
    MAX_AUDIT_METADATA_LENGTH,
    AuditService,
    audit_metadata_object,
)
from app.services.s3_execution_context import S3ExecutionContext
from tests.s3_account_factory import make_s3_account


def _create_user(db_session) -> User:
    user = User(
        email="audit-user@example.com",
        full_name="Audit User",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_record_action_persists_account_as_canonical_context(db_session) -> None:
    user = _create_user(db_session)
    account = make_s3_account(db_session, name="persisted-account")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="browser",
        action="update_bucket_versioning",
        entity_type="bucket",
        entity_id="bucket-a",
        account=account,
    )

    log = db_session.scalars(select(AuditLog)).one()
    assert log.user_id == user.id
    assert log.context_kind == "account"
    assert log.context_id == str(account.id)
    assert log.context_name == "persisted-account"


def test_record_action_refuses_to_commit_pending_business_change(db_session) -> None:
    user = _create_user(db_session)
    user.full_name = "Updated before audit"

    with pytest.raises(
        RuntimeError,
        match="business database changes to be committed first",
    ):
        AuditService(db_session).record_action(
            user=user,
            scope="admin",
            action="review_ui_consistency",
        )

    db_session.rollback()
    db_session.refresh(user)
    assert user.full_name == "Audit User"
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_record_action_persists_generic_execution_context(db_session) -> None:
    user = _create_user(db_session)
    synthetic_account = S3ExecutionContext(
        context_id="conn-1",
        context_kind="connection",
        name="synthetic-connection-context",
        access_key="access",
        secret_key="secret",
        s3_connection_id=1,
    )

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="browser",
        action="update_bucket_versioning",
        entity_type="bucket",
        entity_id="bucket-b",
        execution_context=synthetic_account,
    )

    log = db_session.scalars(select(AuditLog)).one()
    assert log.user_id == user.id
    assert log.context_kind == "connection"
    assert log.context_id == "conn-1"
    assert log.context_name == "synthetic-connection-context"


def test_record_action_persists_account_execution_context(db_session) -> None:
    user = _create_user(db_session)
    account = make_s3_account(db_session, name="manager-account-context")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    AuditService(db_session).record_action(
        user=user,
        scope="manager",
        action="update_bucket_versioning",
        entity_type="bucket",
        entity_id="bucket-c",
        execution_context=S3ExecutionContext.from_account(account),
    )

    log = db_session.scalars(select(AuditLog)).one()
    assert log.context_kind == "account"
    assert log.context_id == str(account.id)
    assert log.context_name == account.name


def test_record_action_accepts_manager_session_actor(db_session) -> None:
    actor = ManagerSessionPrincipal(
        session_id="session-1",
        access_key="access",
        secret_key="secret",
        actor_type="access_key",
        account_id=None,
        account_name="Session account",
        user_uid=None,
        capabilities=SessionCapabilities(can_manage_iam=True),
    )

    AuditService(db_session).record_action(
        user=actor,
        scope="manager",
        action="create_iam_user",
        entity_type="iam_user",
        entity_id="session-created-user",
    )

    log = db_session.scalars(select(AuditLog)).one()
    assert log.user_id is None
    assert log.user_email == actor.email
    assert log.user_role == actor.role


def test_record_action_does_not_persist_transient_user_primary_key(db_session) -> None:
    actor = User(
        id=999,
        email="synthetic-admin@example.com",
        full_name="Synthetic Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )

    AuditService(db_session).record_action(
        user=actor,
        scope="admin",
        action="review_ui_consistency",
    )

    log = db_session.scalars(select(AuditLog)).one()
    assert log.user_id is None
    assert log.user_email == actor.email
    assert log.user_role == actor.role


def test_serialize_log_matches_the_public_audit_contract(db_session) -> None:
    user = _create_user(db_session)
    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="admin",
        action="review_ui_consistency",
    )

    payload = service.serialize_log(db_session.scalars(select(AuditLog)).one())

    assert "user_id" not in payload
    assert AuditLogEntry(**payload).user_email == user.email


def test_list_logs_searches_structured_metadata(db_session) -> None:
    user = _create_user(db_session)
    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="admin",
        action="create_iam_user",
        metadata={"project": "structured-search-marker"},
    )

    rows = service.list_logs(search="structured-search-marker")

    assert len(rows) == 1
    assert rows[0].audit_metadata == {"project": "structured-search-marker"}


def test_audit_response_models_require_complete_canonical_payloads() -> None:
    assert set(AuditLogEntry.model_json_schema()["required"]) == {
        "id",
        "created_at",
        "user_email",
        "user_role",
        "scope",
        "action",
        "entity_type",
        "entity_id",
        "context_kind",
        "context_id",
        "context_name",
        "status",
        "message",
        "metadata",
    }
    assert set(AuditLogListResponse.model_json_schema()["required"]) == {"logs", "next_cursor"}


def test_admin_audit_listing_request_preserves_flat_query_contract() -> None:
    parameters = app.openapi()["paths"]["/api/admin/audit/logs"]["get"]["parameters"]
    by_name = {parameter["name"]: parameter for parameter in parameters}

    assert set(by_name) == {
        "limit",
        "cursor",
        "role",
        "scope",
        "context_kind",
        "context_id",
        "search",
    }
    assert by_name["limit"]["schema"] == {
        "type": "integer",
        "maximum": 500,
        "minimum": 1,
        "default": 200,
        "title": "Limit",
    }
    assert by_name["cursor"]["description"] == "Use the id from the last entry of the previous page"
    assert by_name["role"]["description"] == "Filter by user role"
    assert by_name["scope"]["description"] == "Filter by admin/manager scope"
    assert by_name["context_kind"]["description"] == "Filter by execution-context kind"
    assert by_name["context_id"]["description"] == "Filter by execution-context id"
    assert by_name["search"]["description"] == "Search by actor, action, or target"


def test_list_admin_logs_page_builds_cursor_response(db_session) -> None:
    user = _create_user(db_session)
    service = AuditService(db_session)
    service.record_action(user=user, scope="admin", action="older_event")
    service.record_action(user=user, scope="admin", action="newer_event")

    first_page = service.list_admin_logs_page(AuditLogListingRequest(limit=1, scope="admin"))

    assert [entry.action for entry in first_page.logs] == ["newer_event"]
    assert first_page.next_cursor == first_page.logs[-1].id

    second_page = service.list_admin_logs_page(
        AuditLogListingRequest(limit=2, scope="admin", cursor=first_page.next_cursor)
    )

    assert [entry.action for entry in second_page.logs] == ["older_event"]
    assert second_page.next_cursor is None


def test_record_action_sanitizes_sensitive_metadata_before_persisting(db_session) -> None:
    user = _create_user(db_session)

    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="admin",
        action="connection.update",
        entity_type="s3_connection",
        entity_id="42",
        metadata={
            "endpoint_url": "https://s3.example.test/bucket",
            "access_key_id": "AKIA1234567890ABCDEF",
            "secret_access_key": "secret-value",
            "client_secret": "oauth-secret",
            "client_secret_action": "set",
            "bind_password_action": "clear",
            "nested": {
                "token": "session-token-value",
                "note": (
                    "failed with token=leaked and "
                    "X-Amz-Signature=deadbeef at https://rgw.internal/object"
                ),
            },
            "items": [{"password": "plain-password"}],
        },
    )

    log = db_session.scalars(select(AuditLog)).one()
    metadata = log.audit_metadata or {}
    assert metadata["endpoint_url"] == "https://s3.example.test/bucket"
    assert metadata["access_key_id"] == "AKIA1234567890ABCDEF"
    assert metadata["secret_access_key"] == "<redacted>"
    assert metadata["client_secret"] == "<redacted>"
    assert metadata["client_secret_action"] == "set"
    assert metadata["bind_password_action"] == "clear"
    assert metadata["nested"]["token"] == "<redacted>"
    assert "token=<redacted>" in metadata["nested"]["note"]
    assert "X-Amz-Signature=<redacted>" in metadata["nested"]["note"]
    assert "https://rgw.internal/object" in metadata["nested"]["note"]
    assert metadata["items"][0]["password"] == "<redacted>"
    serialized_metadata = json.dumps(log.audit_metadata or {})
    assert "secret-value" not in serialized_metadata
    assert "oauth-secret" not in serialized_metadata
    assert "session-token-value" not in serialized_metadata
    assert "plain-password" not in serialized_metadata


def test_audit_metadata_truncation_remains_valid_json(db_session) -> None:
    user = _create_user(db_session)
    service = AuditService(db_session)
    service.record_action(
        user=user,
        scope="admin",
        action="large_metadata",
        metadata={"details": 'value with "quotes" and \\slashes ' * 1000},
    )

    log = db_session.scalars(select(AuditLog)).one()
    assert log.audit_metadata is not None
    assert len(json.dumps(log.audit_metadata)) <= MAX_AUDIT_METADATA_LENGTH
    metadata = audit_metadata_object(log.audit_metadata)
    assert metadata is not None
    assert metadata["truncated"] is True
    assert metadata["original_length"] > MAX_AUDIT_METADATA_LENGTH
    assert metadata["preview"].startswith('{"details":')


def test_audit_metadata_object_rejects_noncanonical_storage() -> None:
    assert audit_metadata_object(None) is None
    assert audit_metadata_object({"key": "value"}) == {"key": "value"}

    for raw in ("value", [], ["value"]):
        with pytest.raises(ValueError):
            audit_metadata_object(raw)


@pytest.mark.parametrize(
    "action",
    sorted(DATA_PLANE_AUDIT_ACTIONS | NON_AUDIT_OPERATION_ACTIONS),
)
@pytest.mark.parametrize("status", ["success", "failure"])
def test_record_action_does_not_persist_excluded_actions(
    db_session,
    action: str,
    status: str,
) -> None:
    AuditService(db_session).record_action(
        user=None,
        user_email="actor@example.com",
        user_role="user",
        scope="browser",
        action=action,
        status=status,
        metadata={"secret_access_key": "must-not-be-processed"},
    )

    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0
    assert should_persist_audit_action(action) is False


@pytest.mark.parametrize(
    "action",
    [
        "login_success",
        "logout",
        "revoke_api_token",
        "create_iam_user",
        "create_portal_share",
        "create_public_link",
        "update_bucket_versioning",
        "update_project_portal_settings",
        "start_bucket_migration",
        "finish_storage_space_history_cleanup",
    ],
)
def test_record_action_keeps_control_security_and_workflow_actions(
    db_session,
    action: str,
) -> None:
    AuditService(db_session).record_action(
        user=None,
        user_email="actor@example.com",
        user_role="user",
        scope="portal",
        action=action,
    )

    assert db_session.scalars(select(AuditLog)).one().action == action
    assert should_persist_audit_action(action) is True
