# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from tests_ceph_functional.resources import ResourceTracker


@dataclass
class _OperationResult:
    success: bool = True
    status_code: int = 200
    error_code: str | None = None


class _AdminSession:
    def __init__(self) -> None:
        self.deleted: list[tuple[str, dict[str, Any], dict[str, Any], Any]] = []

    def get(self, path: str):
        assert path == "/admin/accounts/7"
        return {"storage_endpoint_id": 3}

    def delete(self, path: str, *, params=None, json=None, expected_status=(200,)):
        self.deleted.append((path, params or {}, json or {}, expected_status))
        return {}


class _RgwAdminClient:
    def __init__(self) -> None:
        self.deleted_buckets: list[tuple[str, bool]] = []

    def delete_bucket_operation(self, bucket: str, *, purge_objects: bool = False):
        self.deleted_buckets.append((bucket, purge_objects))
        return _OperationResult()


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
