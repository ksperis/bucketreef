# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

import pytest

from .ceph_admin_helpers import run_or_skip
from .clients import BackendSession
from .conftest import CephAdminEndpointTestContext
from .resources import ResourceTracker


def _find_user(items: list[dict], uid: str) -> dict | None:
    for item in items:
        if str(item.get("uid") or "").strip() == uid:
            return item
    return None


@pytest.mark.ceph_functional
def test_ceph_admin_users_listing_detail_config_keys_and_metrics(
    super_admin_session: BackendSession,
    ceph_admin_endpoint: CephAdminEndpointTestContext,
    resource_tracker: ResourceTracker,
) -> None:
    endpoint_id = ceph_admin_endpoint.endpoint_id
    uid = f"cau-{uuid.uuid4().hex[:8]}"
    base_path = f"/ceph-admin/endpoints/{endpoint_id}/users"

    created_user = run_or_skip(
        "ceph-admin user creation",
        lambda: super_admin_session.post(
            base_path,
            json={
                "uid": uid,
                "display_name": uid,
                "email": f"{uid}@example.com",
                "generate_key": True,
            },
            expected_status=201,
        ),
    )
    resource_tracker.track_ceph_admin_user(uid, tenant=None)
    assert created_user["detail"]["uid"] == uid

    listing = run_or_skip(
        "ceph-admin users listing",
        lambda: super_admin_session.get(
            base_path,
            params={
                "search": uid,
                "page": 1,
                "page_size": 50,
                "sort_by": "uid",
                "sort_dir": "asc",
                "include": "account,profile,status,limits,quota",
            },
        ),
    )
    matched = _find_user(listing.get("items", []), uid)
    assert matched is not None
    tenant = matched.get("tenant")
    tenant_query = {"tenant": tenant} if tenant else {}

    detail = run_or_skip(
        "ceph-admin user detail",
        lambda: super_admin_session.get(f"{base_path}/{uid}/detail", params=tenant_query),
    )
    assert detail["uid"] == uid

    updated = run_or_skip(
        "ceph-admin user config update",
        lambda: super_admin_session.patch(
            f"{base_path}/{uid}/config",
            params=tenant_query,
            json={
                "display_name": f"{uid}-display",
                "max_buckets": 9,
                "caps": {"mode": "add", "values": ["usage=read"]},
                "quota_enabled": True,
                "quota_max_objects": 1000,
            },
        ),
    )
    assert updated["uid"] == uid
    if updated.get("max_buckets") is not None:
        assert int(updated["max_buckets"]) == 9

    keys_before = run_or_skip(
        "ceph-admin list user keys",
        lambda: super_admin_session.get(f"{base_path}/{uid}/keys", params=tenant_query),
    )
    assert isinstance(keys_before, list)

    generated_key = run_or_skip(
        "ceph-admin create user key",
        lambda: super_admin_session.post(f"{base_path}/{uid}/keys", params=tenant_query, expected_status=201),
    )
    access_key = generated_key["access_key"]
    assert generated_key.get("secret_key")

    suspended = run_or_skip(
        "ceph-admin disable user key",
        lambda: super_admin_session.put(
            f"{base_path}/{uid}/keys/{access_key}/status",
            params=tenant_query,
            json={"active": False},
        ),
    )
    assert suspended["access_key"] == access_key
    assert suspended.get("is_active") in {False, None}

    reenabled = run_or_skip(
        "ceph-admin enable user key",
        lambda: super_admin_session.put(
            f"{base_path}/{uid}/keys/{access_key}/status",
            params=tenant_query,
            json={"active": True},
        ),
    )
    assert reenabled["access_key"] == access_key

    run_or_skip(
        "ceph-admin delete user key",
        lambda: super_admin_session.delete(
            f"{base_path}/{uid}/keys/{access_key}",
            params=tenant_query,
            expected_status=(204,),
        ),
    )

    raw_payload = run_or_skip(
        "ceph-admin raw user payload",
        lambda: super_admin_session.get(f"{base_path}/{uid}", params=tenant_query),
    )
    assert isinstance(raw_payload, dict)

    if ceph_admin_endpoint.can_metrics:
        metrics = run_or_skip(
            "ceph-admin user metrics",
            lambda: super_admin_session.get(f"{base_path}/{uid}/metrics", params=tenant_query),
        )
        assert "bucket_count" in metrics
        assert "generated_at" in metrics
