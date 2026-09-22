# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

import pytest
from botocore.exceptions import ClientError

from app.db import S3Account, StorageEndpoint
from app.services.manager_object_listing_service import (
    ManagerObjectListingService,
    get_manager_object_listing_service,
)


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


def _account() -> S3Account:
    account = S3Account(
        name="objects-account",
        rgw_access_key="AKIA-OBJ",
        rgw_secret_key="SECRET-OBJ",
    )
    account.storage_endpoint = StorageEndpoint(
        name="objects-endpoint",
        endpoint_url="https://s3.example.test",
    )
    return account


def test_client_requires_execution_credentials():
    account = S3Account(name="missing-keys", rgw_access_key=None, rgw_secret_key=None)

    with pytest.raises(RuntimeError, match="Execution context credentials are missing"):
        ManagerObjectListingService()._client(account)


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

    result = service.list_objects("bucket-1", _account(), prefix="logs/")

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

    result = service.list_objects("bucket-1", _account(), prefix="logs/")

    assert [item.key for item in result.objects] == ["logs//", "logs///"]


def test_list_objects_wraps_errors(monkeypatch):
    service = ManagerObjectListingService()
    fake = _FakeS3Client()
    fake.raise_on["list_objects_v2"] = _client_error("AccessDenied")
    monkeypatch.setattr(
        "app.services.manager_object_listing_service.get_s3_client",
        lambda *args, **kwargs: fake,
    )

    with pytest.raises(RuntimeError, match="Unable to list objects"):
        service.list_objects("bucket-1", _account())


def test_get_manager_object_listing_service_factory():
    assert isinstance(get_manager_object_listing_service(), ManagerObjectListingService)
