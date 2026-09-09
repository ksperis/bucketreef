# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.responses import JSONResponse

from app.db import User, UserRole
from app.main import app
from app.models.bucket_purge import (
    BucketPurgeResult,
    bucket_delete_with_purge_confirmation_phrase,
    bucket_purge_confirmation_phrase,
)
from app.routers import dependencies
from app.routers.manager import buckets, integrity, purge, usage_stats
from tests.execution_context_factory import make_s3_execution_context


@pytest.fixture(params=[
    ("account", "1", "0001", {"id": 1}),
    ("connection", "conn-8", "conn-0008", {"id": None, "s3_connection_id": 8}),
    ("s3_user", "s3u-3", "s3u-0003", {"id": None, "s3_user_id": 3}),
    ("session", "1", None, {"id": 1}),
    ("session", "session:rgw-one", None, {"id": None}),
], ids=["account-alias", "connection-alias", "s3-user-alias", "bound-session", "unbound-session"])
def selected_context(request):
    kind, context_id, selector, overrides = request.param
    return make_s3_execution_context(
        context_kind=kind,
        context_id=context_id,
        can_manage_buckets=True,
        name="Selected executor",
        **overrides,
    ), {} if selector is None else {"account_id": selector}


@pytest.mark.parametrize("operation", ["usage", "aggregate-usage", "integrity", "purge", "delete"])
def test_manager_operations_use_resolved_context(client, monkeypatch, selected_context, operation):
    account, params = selected_context
    actor = User(
        id=77, email="operator@example.test", hashed_password="x",
        is_active=True, role=UserRole.UI_USER.value,
    )
    captured = {}
    audit_calls = []
    timestamp = datetime(2026, 9, 9, tzinfo=timezone.utc)
    result = BucketPurgeResult(
        status="completed", started_at=timestamp, finished_at=timestamp,
    )

    class FakeService:
        def __init__(self, *_args):
            pass

        def run(self, targets, _options, **_kwargs):
            captured["targets"] = targets
            return result

        def run_delete_bucket_with_purge(self, target, options, **kwargs):
            return self.run([target], options, **kwargs)

    def fake_stream(_request, *, run_check=None, run_purge=None, on_start=None, on_result=None, **_kwargs):
        if on_start:
            on_start("operation-test")
        callback = run_check or run_purge
        output = callback(lambda _event: None, lambda: False)
        if on_result:
            on_result("operation-test", output)
        return JSONResponse({"ok": True})

    app.dependency_overrides[dependencies.require_manager_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[dependencies.get_current_account_admin] = lambda: actor

    if operation in {"usage", "aggregate-usage"}:
        module = usage_stats
        monkeypatch.setattr(module, "BucketUsageStatsService", FakeService)
        monkeypatch.setattr(module, "stream_bucket_usage_stats", fake_stream)
        monkeypatch.setattr(module, "_list_manager_bucket_names", lambda *_args: ["bucket-a"])
        app.dependency_overrides[module.require_bucket_usage_stats_enabled] = lambda: actor
        app.dependency_overrides[module.get_buckets_service] = lambda: object()
        path = "/api/manager/usage-stats/stream" if operation == "aggregate-usage" else "/api/manager/buckets/bucket-a/usage-stats/stream"
        payload = {}
    elif operation == "integrity":
        module = integrity
        monkeypatch.setattr(module, "BucketIntegrityCheckService", FakeService)
        monkeypatch.setattr(module, "stream_bucket_integrity_check", fake_stream)
        app.dependency_overrides[module.require_bucket_integrity_check_enabled] = lambda: actor
        path = "/api/manager/bucket-integrity/stream"
        payload = {"buckets": ["bucket-a"]}
    else:
        module = purge if operation == "purge" else buckets
        monkeypatch.setattr(module, "BucketPurgeService", FakeService)
        monkeypatch.setattr(module, "stream_bucket_purge", fake_stream)
        monkeypatch.setattr(module, "record_bucket_purge_audit", lambda **kwargs: audit_calls.append(kwargs))
        app.dependency_overrides[module.require_bucket_purge_enabled] = lambda: actor
        if operation == "purge":
            path = "/api/manager/bucket-purge/stream"
            payload = {"buckets": ["bucket-a"], "confirmation": bucket_purge_confirmation_phrase(1)}
        else:
            path = "/api/manager/buckets/bucket-a/delete/stream"
            payload = {"confirmation": bucket_delete_with_purge_confirmation_phrase("bucket-a")}

    response = client.post(path, params=params, json=payload)

    assert response.status_code == 200, response.text
    target, = captured["targets"]
    assert target.account is account
    assert target.bucket_name == "bucket-a"
    assert target.context_id == account.context_id
    assert target.context_name == account.name
    if operation in {"usage", "aggregate-usage"}:
        assert target.scope_kind == "manager"
        assert target.scope_id == account.context_id
        assert target.scope_name == account.name
    if operation in {"purge", "delete"}:
        assert len(audit_calls) == 2
        assert all(call["metadata"]["context_id"] == account.context_id for call in audit_calls)
        assert all(call["account"] is account for call in audit_calls)
