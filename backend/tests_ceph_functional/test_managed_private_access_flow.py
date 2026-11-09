# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid

import pytest

from .clients import BackendSession
from .config import CephTestSettings
from .resources import ResourceTracker


def _bucket_name(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}-private-access"


@pytest.mark.ceph_functional
def test_managed_personal_access_connection_preserves_identity_and_metrics(
    ceph_test_settings: CephTestSettings,
    super_admin_session: BackendSession,
    provisioned_account,
    resource_tracker: ResourceTracker,
) -> None:
    account_id = provisioned_account.account_id
    manager_session: BackendSession = provisioned_account.manager_session
    manager_user_id = provisioned_account.manager_user_id

    super_admin_session.patch(
        f"/admin/users/{manager_user_id}",
        json={"can_provision_managed_private_connections": True},
        expected_status=200,
    )

    account_context = manager_session.get(
        "/manager/context",
        params={"context_id": account_id, "include_limits": "true"},
    )
    assert account_context["manager_private_access_enabled"] is True

    bucket_name = _bucket_name(ceph_test_settings.test_prefix)
    manager_session.post(
        "/manager/buckets",
        params={"context_id": account_id},
        json={"name": bucket_name, "versioning": False},
        expected_status=201,
    )
    resource_tracker.track_bucket(account_id, bucket_name)

    payload = {
        "connection_name": f"{provisioned_account.account_name} personal access",
        "access_browser": True,
        "access_manager": True,
        "groups": [],
        "managed_policies": ["arn:aws:iam::aws:policy/AmazonS3FullAccess"],
        "inline_policies": [],
    }

    connection_id: int | None = None
    try:
        created = manager_session.post(
            "/manager/private-access/iam",
            params={"context_id": account_id},
            json=payload,
            expected_status=201,
        )
        assert created["status"] == "active"
        connection = created["connection"]
        connection_id = int(connection["id"])
        connection_context_id = f"conn-{connection_id}"

        assert connection["server_managed"] is True
        assert connection["managed_access_state"] == "active"
        assert connection["access_browser"] is True
        assert connection["access_manager"] is True
        assert connection["rgw_account_id"] == provisioned_account.rgw_account_id
        assert connection["rgw_user_uid"]
        if provisioned_account.root_user_uid:
            assert connection["rgw_user_uid"] == provisioned_account.root_user_uid
        assert connection["access_key_id"]
        assert "secret_access_key" not in connection

        repeated = manager_session.post(
            "/manager/private-access/iam",
            params={"context_id": account_id},
            json=payload,
            expected_status=201,
        )
        assert repeated["provisioning_id"] == created["provisioning_id"]
        assert repeated["connection"]["id"] == connection_id

        conflict_payload = {**payload, "connection_name": f"{payload['connection_name']} duplicate"}
        manager_session.request(
            "POST",
            "/manager/private-access/iam",
            params={"context_id": account_id},
            json=conflict_payload,
            expected_status=409,
        )

        active_account_context = manager_session.get(
            "/manager/context",
            params={"context_id": account_id},
        )
        assert active_account_context["manager_private_access_state"] == "active"

        connections = manager_session.get("/connections")
        matching = [item for item in connections if int(item["id"]) == connection_id]
        assert len(matching) == 1

        connection_context = manager_session.get(
            "/manager/context",
            params={"context_id": connection_context_id},
        )
        assert connection_context["context_kind"] == "connection"
        assert connection_context["access_mode"] == "connection"
        assert connection_context["manager_browser_enabled"] is True
        assert connection_context["manager_stats_enabled"] is True
        assert connection_context["iam_identity"]

        buckets = manager_session.get(
            "/manager/buckets",
            params={"context_id": connection_context_id},
        )
        assert any(bucket["name"] == bucket_name for bucket in buckets)

        stats = manager_session.get(
            "/manager/stats/overview",
            params={"context_id": connection_context_id},
        )
        assert stats["total_buckets"] >= 1
        assert any(bucket["name"] == bucket_name for bucket in stats["bucket_usage"])
    finally:
        if connection_id is not None:
            manager_session.delete(
                f"/connections/{connection_id}",
                expected_status=(204, 404),
            )

    after_delete = manager_session.get(
        "/manager/context",
        params={"context_id": account_id},
    )
    assert after_delete["manager_private_access_state"] is None
