# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tests_ceph_functional.clients import BackendAPIError
from tests_ceph_functional.resources import ResourceTracker


@dataclass
class _OperationResult:
    success: bool = True
    status_code: int = 200
    error_code: str | None = None


class _AdminSession:
    def __init__(self) -> None:
        self.deleted: list[tuple[str, dict[str, Any], dict[str, Any], Any]] = []
        self.bucket_items: list[dict[str, Any]] = []
        self.get_calls: list[tuple[str, dict[str, Any]]] = []
        self.account_delete_error: BackendAPIError | None = None

    def get(self, path: str, *, params=None):
        self.get_calls.append((path, params or {}))
        if path == "/admin/accounts/7":
            return {"storage_endpoint_id": 3}
        if path == "/manager/buckets":
            return list(self.bucket_items)
        raise AssertionError(f"unexpected GET {path}")

    def delete(self, path: str, *, params=None, json=None, expected_status=(200,)):
        self.deleted.append((path, params or {}, json or {}, expected_status))
        if (
            path == "/admin/accounts/7"
            and (params or {}).get("delete_rgw") == "true"
            and self.account_delete_error is not None
        ):
            raise self.account_delete_error
        return {}


class _RgwAdminClient:
    def __init__(self) -> None:
        self.deleted_buckets: list[tuple[str, bool]] = []
        self.deleted_accounts: list[str] = []
        self.deleted_users: list[tuple[str, str | None]] = []
        self.list_users_calls = 0
        self.users: dict[str, dict[str, Any]] = {}

    def delete_bucket_operation(self, bucket: str, *, purge_objects: bool = False):
        self.deleted_buckets.append((bucket, purge_objects))
        return _OperationResult()

    def delete_account_operation(self, account_id: str):
        self.deleted_accounts.append(account_id)
        return _OperationResult()

    def delete_account(self, account_id: str):
        self.deleted_accounts.append(account_id)
        return {}

    def list_users(self):
        self.list_users_calls += 1
        return list(self.users)

    def get_user(self, uid: str, tenant: str | None = None, allow_not_found: bool = False):
        key = f"{tenant}${uid}" if tenant else uid
        return self.users.get(key)

    def delete_user(self, uid: str, tenant: str | None = None) -> None:
        self.deleted_users.append((uid, tenant))


def test_cleanup_purges_tracked_bucket_through_ceph_admin() -> None:
    admin = _AdminSession()
    rgw = _RgwAdminClient()
    tracker = ResourceTracker(admin_session=admin, rgw_admin_client=rgw)
    tracker.track_bucket(7, "functional-bucket")

    assert tracker.cleanup() == []

    assert rgw.deleted_buckets == []
    assert admin.deleted == [
        (
            "/ceph-admin/endpoints/3/buckets/functional-bucket",
            {},
            {
                "confirmation": "PURGE AND DELETE BUCKET functional-bucket",
                "purge_objects": True,
                "bypass_gc": False,
            },
            (200, 404),
        )
    ]


def test_cleanup_discovers_and_purges_buckets_through_account_scope() -> None:
    admin = _AdminSession()
    admin.bucket_items = [
        {"name": "derived-portal-bucket", "owner": "RGW00000000000000007"},
    ]
    tracker = ResourceTracker(admin_session=admin)
    tracker.track_account(
        7,
        delete_rgw=True,
        rgw_account_id="RGW00000000000000007",
    )

    assert tracker.cleanup() == []

    assert ("/manager/buckets", {"context_id": 7}) in admin.get_calls
    assert (
        "/ceph-admin/endpoints/3/buckets/derived-portal-bucket",
        {},
        {
            "confirmation": "PURGE AND DELETE BUCKET derived-portal-bucket",
            "purge_objects": True,
            "bypass_gc": False,
        },
        (200, 404),
    ) in admin.deleted
    assert (
        "/admin/accounts/7",
        {"delete_rgw": "true"},
        {},
        (204,),
    ) in admin.deleted


def test_cleanup_deletes_empty_ceph_admin_account_without_global_user_scan() -> None:
    admin = _AdminSession()
    rgw = _RgwAdminClient()
    tracker = ResourceTracker(admin_session=admin, rgw_admin_client=rgw)
    tracker.track_ceph_admin_account("RGW00000000000000008")

    assert tracker.cleanup() == []

    assert rgw.deleted_accounts == ["RGW00000000000000008"]
    assert rgw.list_users_calls == 0


def test_cleanup_falls_back_when_rgw_account_verification_is_unavailable() -> None:
    admin = _AdminSession()
    admin.account_delete_error = BackendAPIError(
        "Unable to delete account",
        status_code=400,
        payload={"detail": "Unable to verify bucket existence; cannot delete the RGW account."},
    )
    rgw = _RgwAdminClient()
    rgw.users = {
        "RGW00000000000000007-admin": {
            "uid": "RGW00000000000000007-admin",
            "account_id": "RGW00000000000000007",
        },
        "unrelated-user": {
            "uid": "unrelated-user",
            "account_id": "RGW00000000000000099",
        },
    }
    tracker = ResourceTracker(admin_session=admin, rgw_admin_client=rgw)
    tracker.track_account(
        7,
        delete_rgw=True,
        rgw_account_id="RGW00000000000000007",
    )

    assert tracker.cleanup() == []

    assert (
        "/admin/accounts/7",
        {"delete_rgw": "false"},
        {},
        (204,),
    ) in admin.deleted
    assert rgw.deleted_users == [("RGW00000000000000007-admin", None)]
    assert rgw.deleted_accounts == ["RGW00000000000000007"]
