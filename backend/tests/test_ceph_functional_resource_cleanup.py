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
        self.posts: list[tuple[str, dict[str, Any], dict[str, Any], Any]] = []
        self.bucket_items: list[dict[str, Any]] = []
        self.get_calls: list[tuple[str, dict[str, Any]]] = []
        self.account_delete_error: BackendAPIError | None = None
        self.bucket_delete_error: BackendAPIError | None = None
        self.bucket_read_error: BackendAPIError | None = None
        self.version_items: list[dict[str, Any]] = []
        self.object_items: list[dict[str, Any]] = []

    def get(self, path: str, *, params=None):
        self.get_calls.append((path, params or {}))
        if path == "/admin/accounts/7":
            return {"storage_endpoint_id": 3}
        if path == "/manager/buckets":
            return list(self.bucket_items)
        if path == "/browser/buckets/functional-bucket/versions":
            if self.bucket_read_error is not None:
                raise self.bucket_read_error
            items = list(self.version_items)
            self.version_items.clear()
            return {
                "versions": [item for item in items if not item.get("is_delete_marker")],
                "delete_markers": [item for item in items if item.get("is_delete_marker")],
            }
        if path == "/browser/buckets/functional-bucket/objects":
            items = list(self.object_items)
            self.object_items.clear()
            return {"objects": items}
        raise AssertionError(f"unexpected GET {path}")

    def delete(self, path: str, *, params=None, json=None, expected_status=(200,)):
        self.deleted.append((path, params or {}, json or {}, expected_status))
        if path.startswith("/ceph-admin/endpoints/") and self.bucket_delete_error is not None:
            raise self.bucket_delete_error
        if (
            path == "/admin/accounts/7"
            and (params or {}).get("delete_rgw") == "true"
            and self.account_delete_error is not None
        ):
            error = self.account_delete_error
            self.account_delete_error = None
            raise error
        return {}

    def post(self, path: str, *, params=None, json=None, expected_status=(200,)):
        self.posts.append((path, params or {}, json or {}, expected_status))
        return {"deleted": len((json or {}).get("objects", []))}


class _RgwAdminClient:
    def __init__(self) -> None:
        self.deleted_buckets: list[tuple[str, bool]] = []
        self.deleted_accounts: list[str] = []
        self.deleted_users: list[tuple[str, str | None]] = []
        self.list_users_calls = 0
        self.users: dict[str, dict[str, Any]] = {}
        self.account_buckets: list[str] = []

    def delete_bucket_operation(
        self,
        bucket: str,
        *,
        tenant: str | None = None,
        purge_objects: bool = False,
    ):
        self.deleted_buckets.append((bucket, purge_objects))
        return _OperationResult()

    def get_all_buckets(
        self,
        uid: str | None = None,
        with_stats: bool = False,
        tenant: str | None = None,
    ):
        return list(self.account_buckets)

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
    assert admin.posts == []


def test_cleanup_falls_back_to_manager_data_plane_when_ceph_admin_delete_fails() -> None:
    admin = _AdminSession()
    admin.bucket_delete_error = BackendAPIError(
        "RGW Admin could not address account bucket",
        status_code=400,
        payload={"detail": "Unable to delete RGW bucket"},
    )
    admin.version_items = [
        {"key": "versioned.txt", "version_id": "v1", "is_delete_marker": False},
        {"key": "deleted.txt", "version_id": "d1", "is_delete_marker": True},
    ]
    admin.object_items = [{"key": "current.txt"}]
    tracker = ResourceTracker(admin_session=admin)
    tracker.track_bucket(7, "functional-bucket")

    assert tracker.cleanup() == []

    assert admin.posts == [
        (
            "/browser/buckets/functional-bucket/delete",
            {"context_id": 7},
            {
                "objects": [
                    {"key": "versioned.txt", "version_id": "v1"},
                    {"key": "deleted.txt", "version_id": "d1"},
                ],
            },
            (200,),
        ),
        (
            "/browser/buckets/functional-bucket/delete",
            {"context_id": 7},
            {"objects": [{"key": "current.txt"}]},
            (200,),
        )
    ]
    assert (
        "/manager/buckets/functional-bucket",
        {"context_id": 7},
        {},
        (204, 404),
    ) in admin.deleted


def test_cleanup_verifies_tracked_multisite_bucket_through_manager_session() -> None:
    admin = _AdminSession()
    manager = _AdminSession()
    tracker = ResourceTracker(admin_session=admin)
    tracker.track_bucket(
        7,
        "functional-bucket",
        execution_endpoint_id=9,
        cleanup_session=manager,
    )

    assert tracker.cleanup() == []

    assert admin.deleted[0][0] == "/ceph-admin/endpoints/9/buckets/functional-bucket"
    assert (
        "/manager/buckets/functional-bucket",
        {"context_id": 7, "execution_endpoint_id": 9},
        {},
        (204, 404),
    ) in manager.deleted
    assert (
        "/browser/buckets/functional-bucket/versions",
        {"context_id": 7, "execution_endpoint_id": 9, "max_keys": 1000},
    ) in manager.get_calls


def test_cleanup_accepts_missing_multisite_bucket_after_ceph_admin_attempt() -> None:
    admin = _AdminSession()
    manager = _AdminSession()
    admin.bucket_delete_error = BackendAPIError(
        "RGW Admin could not address account bucket",
        status_code=400,
        payload={"detail": "Unable to delete RGW bucket"},
    )
    manager.bucket_read_error = BackendAPIError(
        "Unable to list object versions",
        status_code=502,
        payload={"detail": "S3OperationError: NoSuchBucket"},
    )
    tracker = ResourceTracker(admin_session=admin)
    tracker.track_bucket(
        7,
        "functional-bucket",
        execution_endpoint_id=9,
        cleanup_session=manager,
    )

    assert tracker.cleanup() == []
    assert manager.deleted == []


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


def test_cleanup_retries_account_after_direct_rgw_bucket_purge() -> None:
    admin = _AdminSession()
    admin.account_delete_error = BackendAPIError(
        "Unable to delete account",
        status_code=400,
        payload={
            "detail": (
                "Unable to delete RGW account RGW00000000000000007: "
                "RGW admin error 409 code=BucketNotEmpty detail=Upstream service error."
            )
        },
    )
    rgw = _RgwAdminClient()
    rgw.account_buckets = ["residual-cross-endpoint-bucket"]
    tracker = ResourceTracker(admin_session=admin, rgw_admin_client=rgw)
    tracker.track_account(
        7,
        delete_rgw=True,
        rgw_account_id="RGW00000000000000007",
    )

    assert tracker.cleanup() == []

    assert rgw.deleted_buckets == [("residual-cross-endpoint-bucket", True)]
    account_deletes = [
        item
        for item in admin.deleted
        if item[0] == "/admin/accounts/7" and item[1].get("delete_rgw") == "true"
    ]
    assert len(account_deletes) == 2
