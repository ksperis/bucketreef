# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

import pytest
from botocore.exceptions import ClientError

from app.db import StorageEndpoint
from app.services.manager_object_listing_service import ManagerObjectListingService
from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import S3ExecutionContext


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "S3Op")


class _FakeS3Client:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.raise_on: dict[str, Exception] = {}
        self.list_payload: dict = {
            "Contents": [],
            "CommonPrefixes": [],
            "IsTruncated": False,
        }

    def list_objects_v2(self, **kwargs):
        self.calls.append(("list_objects_v2", kwargs))
        err = self.raise_on.get("list_objects_v2")
        if err:
            raise err
        return self.list_payload


def _context(
    *,
    access_key: str | None = "AKIA-OBJ",
    secret_key: str | None = "SECRET-OBJ",
) -> S3ExecutionContext:
    endpoint = StorageEndpoint(
        name="objects-endpoint",
        endpoint_url="https://s3.example.test",
    )
    return S3ExecutionContext(
        context_id="test",
        context_kind="account",
        name="objects-account",
        access_key=access_key,
        secret_key=secret_key,
        storage_endpoint=endpoint,
    )


def test_client_requires_execution_credentials():
    with pytest.raises(S3OperationError, match="Execution context credentials are missing"):
        ManagerObjectListingService()._client(_context(access_key=None, secret_key=None))


def test_client_does_not_mask_unexpected_credential_runtime_error():
    class BrokenContext(S3ExecutionContext):
        def effective_rgw_credentials(self):
            raise RuntimeError("unexpected credential resolver bug")

    with pytest.raises(RuntimeError, match="unexpected credential resolver bug"):
        ManagerObjectListingService()._client(
            BrokenContext(
                context_id="broken",
                context_kind="account",
                name="broken",
                access_key="AKIA-OBJ",
                secret_key="SECRET-OBJ",
            )
        )


def test_list_objects_filters_folder_marker_and_returns_prefixes(monkeypatch):
    service = ManagerObjectListingService()
    fake = _FakeS3Client()
    fake.list_payload = {
        "Contents": [
            {"Key": "logs/", "Size": 0},
            {
                "Key": "logs/app.log",
                "Size": 12,
                "LastModified": datetime(2026, 1, 1),
            },
        ],
        "CommonPrefixes": [{"Prefix": "logs/2026/"}],
        "IsTruncated": True,
        "NextContinuationToken": "next-token",
    }
    monkeypatch.setattr(
        "app.services.manager_object_listing_service.get_s3_client",
        lambda *args, **kwargs: fake,
    )

    result = service.list_objects("bucket-1", _context(), prefix="logs/")

    assert [item.key for item in result.objects] == ["logs/app.log"]
    assert result.prefixes == ["logs/2026/"]
    assert result.is_truncated is True
    assert result.next_continuation_token == "next-token"
    assert fake.calls[0] == (
        "list_objects_v2",
        {
            "Bucket": "bucket-1",
            "Prefix": "logs/",
            "Delimiter": "/",
            "MaxKeys": 1000,
        },
    )


def test_list_objects_preserves_distinct_repeated_slash_markers(monkeypatch):
    service = ManagerObjectListingService()
    fake = _FakeS3Client()
    fake.list_payload = {
        "Contents": [
            {"Key": "logs/", "Size": 0},
            {"Key": "logs//", "Size": 0},
            {"Key": "logs///", "Size": 0},
        ],
        "CommonPrefixes": [],
        "IsTruncated": False,
    }
    monkeypatch.setattr(
        "app.services.manager_object_listing_service.get_s3_client",
        lambda *args, **kwargs: fake,
    )

    result = service.list_objects("bucket-1", _context(), prefix="logs/")

    assert [item.key for item in result.objects] == ["logs//", "logs///"]


def test_list_objects_wraps_errors(monkeypatch):
    service = ManagerObjectListingService()
    fake = _FakeS3Client()
    fake.raise_on["list_objects_v2"] = _client_error("AccessDenied")
    monkeypatch.setattr(
        "app.services.manager_object_listing_service.get_s3_client",
        lambda *args, **kwargs: fake,
    )

    with pytest.raises(S3OperationError, match="Unable to list objects"):
        service.list_objects("bucket-1", _context())
