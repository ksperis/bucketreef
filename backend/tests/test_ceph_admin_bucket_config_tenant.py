# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace

import pytest
from app.routers.ceph_admin import bucket_config_common
from app.services.s3_execution_client import s3_execution_bucket_request_kwargs
from app.services.s3_execution_context import S3ExecutionContext


def test_tenant_bucket_read_uses_explicit_rgw_s3_name(monkeypatch):
    captured: dict[str, object] = {}
    service = object()
    execution_context = object()

    def fake_context(ctx):  # noqa: ANN001
        captured["ctx"] = ctx
        return service, execution_context

    def action(*, service, context, bucket_name):  # noqa: ANN001
        captured["service"] = service
        captured["context"] = context
        captured["bucket_name"] = bucket_name
        return "loaded"

    monkeypatch.setattr(
        bucket_config_common,
        "_ceph_admin_bucket_config_context",
        fake_context,
    )
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=7))

    result = bucket_config_common._run_bucket_config_read(
        ctx,
        "bucket-a",
        tenant=" tenant_a ",
        action=action,
    )

    assert result == "loaded"
    assert captured == {
        "ctx": ctx,
        "service": service,
        "context": execution_context,
        "bucket_name": "tenant_a:bucket-a",
    }


def test_ceph_admin_context_remains_executor_only(monkeypatch):
    captured: dict[str, object] = {}
    context = object()

    monkeypatch.setattr(bucket_config_common, "BucketConfigurationService", object)

    def fake_build(ctx):  # noqa: ANN001
        captured["ctx"] = ctx
        return context

    monkeypatch.setattr(bucket_config_common, "build_ceph_admin_s3_context", fake_build)
    ctx = SimpleNamespace()

    _service, resolved_context = bucket_config_common._ceph_admin_bucket_config_context(ctx)

    assert resolved_context is context
    assert captured == {"ctx": ctx}


def test_invalid_ceph_admin_bucket_tenant_is_rejected():
    ctx = SimpleNamespace(endpoint=SimpleNamespace(id=7))
    with pytest.raises(Exception) as exc_info:
        bucket_config_common.ceph_admin_bucket_target(ctx, "bucket-a", "invalid-tenant")

    assert getattr(exc_info.value, "status_code", None) == 400


def test_only_explicit_ceph_admin_qualified_bucket_relaxes_botocore_validation():
    ceph_admin = S3ExecutionContext(
        context_id="ceph-admin-7",
        context_kind="ceph_admin",
        name="Lab",
        access_key="access",
        secret_key="secret",
        session_endpoint="https://s3.example.test",
    )
    manager = S3ExecutionContext(
        context_id="account-7",
        context_kind="account",
        name="Manager",
        access_key="access",
        secret_key="secret",
        session_endpoint="https://s3.example.test",
    )

    qualified = s3_execution_bucket_request_kwargs(
        ceph_admin,
        "tenant_a:bucket-a",
        error_message="missing",
    )
    plain_ceph = s3_execution_bucket_request_kwargs(
        ceph_admin,
        "bucket-a",
        error_message="missing",
    )
    qualified_manager = s3_execution_bucket_request_kwargs(
        manager,
        "tenant_a:bucket-a",
        error_message="missing",
    )

    assert qualified["force_path_style"] is True
    assert qualified["allow_rgw_qualified_bucket_names"] is True
    assert "allow_rgw_qualified_bucket_names" not in plain_ceph
    assert "allow_rgw_qualified_bucket_names" not in qualified_manager
