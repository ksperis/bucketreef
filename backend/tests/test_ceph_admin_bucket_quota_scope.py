# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.bucket import BucketQuotaUpdate
from app.routers.ceph_admin import bucket_config_core as buckets_router
from app.services.bucket_quota_service import BucketQuotaOperationError
from app.utils.storage_endpoint_features import parse_features_config


class _FakeRGWAdmin:
    def __init__(self, bucket_info: dict) -> None:
        self.bucket_info = bucket_info
        self.last_tenant: str | None = None

    def get_bucket_info(
        self,
        bucket_name: str,
        tenant: str | None = None,
        stats: bool = True,
        allow_not_found: bool = False,
    ):
        self.last_tenant = tenant
        return self.bucket_info


def _build_ctx(bucket_info: dict) -> SimpleNamespace:
    endpoint = SimpleNamespace(
        id=1,
        provider="ceph",
        features=parse_features_config("features:\n  usage:\n    enabled: true\n"),
    )
    return SimpleNamespace(
        endpoint=endpoint,
        rgw_admin=_FakeRGWAdmin(bucket_info),
        access_key="AKIA_TEST",
        secret_key="SECRET_TEST",
        actor=None,
        audit_service=None,
    )


def test_update_quota_builds_tenant_qualified_owner_uid(monkeypatch):
    captured: dict = {}

    def fake_set_bucket_quota(self, name, context, payload, rgw_admin=None, rgw_tenant=None):
        captured["name"] = name
        captured["uid"] = context.rgw_user_uid
        captured["account_id"] = context.rgw_account_id
        captured["has_rgw_admin"] = rgw_admin is not None
        captured["rgw_tenant"] = rgw_tenant

    monkeypatch.setattr(buckets_router.BucketQuotaService, "set_bucket_quota", fake_set_bucket_quota)

    response = buckets_router.update_quota(
        "bucket-a",
        BucketQuotaUpdate(enabled=True, max_size_gb=10, max_size_unit="GiB", max_objects=1000),
        ctx=_build_ctx(
            {
                "bucket": "bucket-a",
                "tenant": "RGW00000000000000001",
                "owner": "tests3user",
            }
        ),
    )

    assert response.status_code == 204
    assert response.body == b""
    assert captured == {
        "name": "bucket-a",
        "uid": "RGW00000000000000001$tests3user",
        "account_id": None,
        "has_rgw_admin": True,
        "rgw_tenant": None,
    }


def test_update_quota_uses_account_owner_identifier_as_uid(monkeypatch):
    captured: dict = {}

    def fake_set_bucket_quota(self, name, context, payload, rgw_admin=None, rgw_tenant=None):
        captured["name"] = name
        captured["uid"] = context.rgw_user_uid
        captured["account_id"] = context.rgw_account_id
        captured["has_rgw_admin"] = rgw_admin is not None
        captured["rgw_tenant"] = rgw_tenant

    monkeypatch.setattr(buckets_router.BucketQuotaService, "set_bucket_quota", fake_set_bucket_quota)

    response = buckets_router.update_quota(
        "bucket-b",
        BucketQuotaUpdate(enabled=True, max_size_gb=1, max_size_unit="GiB"),
        ctx=_build_ctx(
            {
                "bucket": "bucket-b",
                "owner": "RGW00000000000000009",
            }
        ),
    )

    assert response.status_code == 204
    assert response.body == b""
    assert captured == {
        "name": "bucket-b",
        "uid": None,
        "account_id": "RGW00000000000000009",
        "has_rgw_admin": True,
        "rgw_tenant": None,
    }


def test_update_quota_preserves_explicit_bucket_tenant(monkeypatch):
    captured: dict = {}
    ctx = _build_ctx(
        {
            "bucket": "bucket-a",
            "tenant": "tenant_a",
            "owner": "owner-a",
        }
    )

    def fake_set_bucket_quota(
        self,
        name,
        context,
        payload,
        rgw_admin=None,
        rgw_tenant=None,
    ):  # noqa: ANN001
        captured["name"] = name
        captured["context_tenant"] = context.rgw_tenant
        captured["target_tenant"] = rgw_tenant

    monkeypatch.setattr(buckets_router.BucketQuotaService, "set_bucket_quota", fake_set_bucket_quota)

    response = buckets_router.update_quota(
        "bucket-a",
        BucketQuotaUpdate(enabled=True, max_objects=10),
        tenant="tenant_a",
        ctx=ctx,
    )

    assert response.status_code == 204
    assert response.body == b""
    assert ctx.rgw_admin.last_tenant == "tenant_a"
    assert captured == {
        "name": "bucket-a",
        "context_tenant": None,
        "target_tenant": "tenant_a",
    }


def test_update_quota_maps_expected_operation_failure_to_bad_gateway(monkeypatch):
    def fail_quota(*_args, **_kwargs):
        raise BucketQuotaOperationError("quota provider unavailable")

    monkeypatch.setattr(buckets_router.BucketQuotaService, "set_bucket_quota", fail_quota)

    with pytest.raises(HTTPException) as exc_info:
        buckets_router.update_quota(
            "bucket-a",
            BucketQuotaUpdate(enabled=True, max_objects=10),
            ctx=_build_ctx({"bucket": "bucket-a", "owner": "RGW00000000000000009"}),
        )

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "quota provider unavailable"


def test_update_quota_propagates_unexpected_runtime_failure(monkeypatch):
    def fail_quota(*_args, **_kwargs):
        raise RuntimeError("unexpected quota regression")

    monkeypatch.setattr(buckets_router.BucketQuotaService, "set_bucket_quota", fail_quota)

    with pytest.raises(RuntimeError, match="unexpected quota regression"):
        buckets_router.update_quota(
            "bucket-a",
            BucketQuotaUpdate(enabled=True, max_objects=10),
            ctx=_build_ctx({"bucket": "bucket-a", "owner": "RGW00000000000000009"}),
        )
