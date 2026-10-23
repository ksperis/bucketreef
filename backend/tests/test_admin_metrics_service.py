# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace

from app.services.admin_metrics_service import AdminMetricsService
from app.services.rgw_admin import RGWAdminError


def test_storage_snapshot_fallback_aggregates_accounts_without_double_counting_user_buckets(monkeypatch):
    rgw_admin = SimpleNamespace()
    service = AdminMetricsService(db=SimpleNamespace(), rgw_admin=rgw_admin, endpoint_id=7)
    accounts = [
        SimpleNamespace(rgw_tenant="", id=1, rgw_account_id="account-1", rgw_user_uid="root-1", name="Account 1"),
        SimpleNamespace(rgw_tenant="", id=2, rgw_account_id="account-2", rgw_user_uid="root-2", name="Account 2"),
    ]
    s3_users = [SimpleNamespace(rgw_tenant="", id=3, rgw_user_uid="user-3", name="User 3")]

    monkeypatch.setattr(service, "_load_scope_targets", lambda: (accounts, s3_users, {"account-1"}))

    def fail_consolidated_listing() -> list[dict]:
        raise RGWAdminError("consolidated listing unavailable")

    monkeypatch.setattr(service, "_fetch_all_buckets", fail_consolidated_listing)

    def collect_bucket_usage(*, uid, context):
        if context == "account:1":
            return 100, 10, 2
        if context == "account:2":
            return None, None, None
        assert (uid, context) == ("user-3", "s3_user:3")
        return 25, 3, 1

    monkeypatch.setattr(service, "_collect_bucket_usage", collect_bucket_usage)

    snapshot = service._storage_snapshot()

    assert snapshot["total_accounts"] == 2
    assert snapshot["total_s3_users"] == 1
    assert snapshot["storage_totals"] == {
        "used_bytes": 100,
        "object_count": 10,
        "bucket_count": 2,
        "accounts_with_usage": 1,
    }
    assert [entry["account_id"] for entry in snapshot["account_usage"]] == ["account-1"]
    assert snapshot["s3_user_usage"] == [
        {
            "user_id": 3,
            "user_name": "User 3",
            "rgw_user_uid": "user-3",
            "used_bytes": 25,
            "object_count": 3,
            "bucket_count": 1,
        }
    ]


def test_consolidated_storage_snapshot_indexes_owner_usage_and_keeps_unmapped_totals():
    service = AdminMetricsService(db=SimpleNamespace(), rgw_admin=SimpleNamespace(), endpoint_id=7)
    accounts = [
        SimpleNamespace(rgw_tenant="", id=1, rgw_account_id="account-1", rgw_user_uid="root-1", name="Account 1"),
    ]
    s3_users = [SimpleNamespace(rgw_tenant="", id=3, rgw_user_uid="user-3", name="User 3")]
    buckets = [
        {
            "bucket": "account-bucket",
            "owner": "account-1",
            "usage": {"total_bytes": 100, "total_objects": 10},
        },
        {
            "bucket": "user-bucket",
            "owner": "user-3",
            "usage": {"total_bytes": 25, "total_objects": 3},
        },
        {
            "bucket": "unmapped-bucket",
            "owner": "external-owner",
            "usage": {"total_bytes": 5, "total_objects": 1},
        },
    ]

    snapshot = service._storage_snapshot_from_bucket_list(
        accounts,
        s3_users,
        buckets,
    )

    assert snapshot["total_accounts"] == 1
    assert snapshot["total_s3_users"] == 1
    assert snapshot["storage_totals"] == {
        "used_bytes": 130,
        "object_count": 14,
        "bucket_count": 3,
        "accounts_with_usage": 1,
    }
    assert snapshot["account_usage"] == [
        {
            "account_id": "account-1",
            "account_name": "Account 1",
            "used_bytes": 100,
            "object_count": 10,
            "bucket_count": 1,
        }
    ]
    assert snapshot["s3_user_usage"] == [
        {
            "user_id": 3,
            "user_name": "User 3",
            "rgw_user_uid": "user-3",
            "used_bytes": 25,
            "object_count": 3,
            "bucket_count": 1,
        }
    ]
