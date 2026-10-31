# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime, timezone

import pytest

from app.db import S3Account
from app.main import app
from app.models.browser import ObjectAcl, ObjectLegalHold, ObjectRetention, ObjectTag, ObjectTags
from app.routers import browser as browser_router
from app.routers import dependencies


def _account() -> S3Account:
    account = S3Account(name="object-read-routes")
    account.id = 78
    return account


class _FakeObjectReadService:
    def __init__(self, result, *, error: RuntimeError | None = None):  # noqa: ANN001
        self.result = result
        self.error = error
        self.calls: list[tuple[str, int, str, str | None]] = []

    def _read(self, bucket_name, context, key, version_id=None):  # noqa: ANN001
        self.calls.append((bucket_name, context.id, key, version_id))
        if self.error is not None:
            raise self.error
        return self.result

    get_object_tags = _read
    get_object_acl = _read
    get_object_legal_hold = _read
    get_object_retention = _read


_READ_CASES = [
    (
        "object-tags",
        ObjectTags(
            key="folder/demo.txt",
            tags=[ObjectTag(key="env", value="dev")],
            version_id="v1",
        ),
        {
            "key": "folder/demo.txt",
            "tags": [{"key": "env", "value": "dev"}],
            "version_id": "v1",
        },
    ),
    (
        "object-acl",
        ObjectAcl(key="folder/demo.txt", acl="private", version_id="v1"),
        {"key": "folder/demo.txt", "acl": "private", "version_id": "v1"},
    ),
    (
        "object-legal-hold",
        ObjectLegalHold(key="folder/demo.txt", status="ON", version_id="v1"),
        {"key": "folder/demo.txt", "status": "ON", "version_id": "v1"},
    ),
    (
        "object-retention",
        ObjectRetention(
            key="folder/demo.txt",
            mode="GOVERNANCE",
            retain_until=datetime(2026, 11, 30, 12, 0, tzinfo=timezone.utc),
            version_id="v1",
        ),
        {
            "key": "folder/demo.txt",
            "mode": "GOVERNANCE",
            "retain_until": "2026-11-30T12:00:00Z",
            "version_id": "v1",
        },
    ),
]


@pytest.mark.parametrize(("endpoint", "result", "expected"), _READ_CASES)
def test_browser_object_read_routes_forward_common_arguments(client, endpoint, result, expected):  # noqa: ANN001
    service = _FakeObjectReadService(result)
    app.dependency_overrides[dependencies.get_s3_execution_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: service

    response = client.get(
        f"/api/browser/buckets/my-bucket/{endpoint}"
        "?key=folder%2Fdemo.txt&version_id=v1&context_id=s3u-1"
    )

    assert response.status_code == 200
    assert response.json() == expected
    assert service.calls == [("my-bucket", 78, "folder/demo.txt", "v1")]


@pytest.mark.parametrize(("endpoint", "result", "_expected"), _READ_CASES)
def test_browser_object_read_routes_reject_empty_key(client, endpoint, result, _expected):  # noqa: ANN001
    service = _FakeObjectReadService(result)
    app.dependency_overrides[dependencies.get_s3_execution_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: service

    response = client.get(
        f"/api/browser/buckets/my-bucket/{endpoint}?key=&context_id=s3u-1"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing key"
    assert service.calls == []


@pytest.mark.parametrize(("endpoint", "result", "_expected"), _READ_CASES)
def test_browser_object_read_routes_map_runtime_errors(client, endpoint, result, _expected):  # noqa: ANN001
    service = _FakeObjectReadService(result, error=RuntimeError("S3 object detail read failed"))
    app.dependency_overrides[dependencies.get_s3_execution_context] = _account
    app.dependency_overrides[browser_router.get_browser_service] = lambda: service

    response = client.get(
        f"/api/browser/buckets/my-bucket/{endpoint}"
        "?key=folder%2Fdemo.txt&version_id=v1&context_id=s3u-1"
    )

    assert response.status_code == 502
    assert "S3 object detail read failed" in response.json()["detail"]
    assert service.calls == [("my-bucket", 78, "folder/demo.txt", "v1")]
