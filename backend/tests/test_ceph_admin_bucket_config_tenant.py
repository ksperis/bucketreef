# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers.ceph_admin import bucket_config_common


def test_tenant_bucket_read_uses_explicit_rgw_s3_name(monkeypatch):
    captured: dict[str, object] = {}
    service = object()
    execution_context = object()

    def fake_context(ctx, tenant=None):  # noqa: ANN001
        captured["ctx"] = ctx
        captured["tenant"] = tenant
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
    ctx = SimpleNamespace()

    result = bucket_config_common._run_bucket_config_read(
        ctx,
        "bucket-a",
        tenant=" tenant_a ",
        action=action,
    )

    assert result == "loaded"
    assert captured == {
        "ctx": ctx,
        "tenant": " tenant_a ",
        "service": service,
        "context": execution_context,
        "bucket_name": "tenant_a:bucket-a",
    }


def test_ceph_admin_context_carries_normalized_tenant(monkeypatch):
    captured: dict[str, object] = {}
    context = object()

    monkeypatch.setattr(bucket_config_common, "BucketConfigurationService", object)

    def fake_build(ctx, *, rgw_tenant=None):  # noqa: ANN001
        captured["ctx"] = ctx
        captured["rgw_tenant"] = rgw_tenant
        return context

    monkeypatch.setattr(bucket_config_common, "build_ceph_admin_s3_context", fake_build)
    ctx = SimpleNamespace()

    _service, resolved_context = bucket_config_common._ceph_admin_bucket_config_context(
        ctx,
        " tenant_a ",
    )

    assert resolved_context is context
    assert captured == {"ctx": ctx, "rgw_tenant": "tenant_a"}


def test_invalid_ceph_admin_bucket_tenant_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        bucket_config_common.ceph_admin_s3_bucket_name("bucket-a", "invalid-tenant")

    assert exc_info.value.status_code == 400
