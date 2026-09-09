# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from app.main import app
from app.routers import browser, dependencies
from app.services.browser import _shared
from app.services.browser_service import BrowserService
from tests.execution_context_factory import make_s3_execution_context


EXACT_KEYS = [
    "report.txt", " report.txt ", " ", "\tline\n.txt", "café.txt", "cafe\u0301.txt",
    "dir/../report.txt", "dir//report.txt", "file%2Fname+?#.txt",
]


@pytest.fixture
def storage(monkeypatch, client):
    service = BrowserService()
    sdk = Mock()
    account = make_s3_execution_context()
    monkeypatch.setattr(service, "_client", lambda *_args, **_kwargs: sdk)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[browser.get_browser_service] = lambda: service
    for cache in (_shared._OBJECT_LAZY_HEAD_CACHE, _shared._OBJECT_LAZY_TAGS_CACHE):
        cache.invalidate_where(lambda _key: True)
    yield sdk
    for cache in (_shared._OBJECT_LAZY_HEAD_CACHE, _shared._OBJECT_LAZY_TAGS_CACHE):
        cache.invalidate_where(lambda _key: True)


def test_http_columns_preserve_distinct_exact_keys_and_cache_entries(client, storage):
    def head_object(*, Bucket, Key):
        assert Bucket == "target"
        index = EXACT_KEYS.index(Key)
        return {"ContentType": f"application/type-{index}", "Metadata": {str(i): "value" for i in range(index)}}

    def get_object_tagging(*, Bucket, Key):
        assert Bucket == "target"
        return {"TagSet": [{"Key": str(i), "Value": "value"} for i in range(EXACT_KEYS.index(Key))]}

    storage.head_object.side_effect = head_object
    storage.get_object_tagging.side_effect = get_object_tagging
    for keys in (EXACT_KEYS + [EXACT_KEYS[1]], list(reversed(EXACT_KEYS))):
        response = client.post("/api/browser/buckets/target/objects/columns", json={
            "keys": keys, "columns": ["content_type", "metadata_count", "tags_count"],
        })
        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert [item["key"] for item in items] == list(dict.fromkeys(keys))
        for item in items:
            index = EXACT_KEYS.index(item["key"])
            assert item["content_type"] == f"application/type-{index}"
            assert item["metadata_count"] == item["tags_count"] == index

    assert [call.kwargs["Key"] for call in storage.head_object.call_args_list] == EXACT_KEYS
    assert [call.kwargs["Key"] for call in storage.get_object_tagging.call_args_list] == EXACT_KEYS


@pytest.mark.parametrize("selected", EXACT_KEYS)
def test_http_version_filter_never_targets_a_trimmed_or_prefix_neighbor_key(client, storage, selected):
    returned_keys = list(dict.fromkeys([selected, selected.strip(), selected + "/nested", "report.txt"]))
    storage.list_object_versions.return_value = {
        "Versions": [{"Key": key, "VersionId": " v "} for key in returned_keys],
        "DeleteMarkers": [{"Key": key, "VersionId": " m "} for key in returned_keys],
        "IsTruncated": True, "NextKeyMarker": " next +%2F ", "NextVersionIdMarker": " next version ",
    }

    response = client.get("/api/browser/buckets/target/versions", params={
        "key": selected, "prefix": "unselected/", "delimiter": "/",
        "key_marker": " previous +%2F ", "version_id_marker": " previous version ", "max_keys": 12,
    })

    assert response.status_code == 200, response.text
    storage.list_object_versions.assert_called_once_with(
        Bucket="target", Prefix=selected, MaxKeys=12,
        KeyMarker=" previous +%2F ", VersionIdMarker=" previous version ",
    )
    result = response.json()
    assert result["prefix"] == selected
    assert [(item["key"], item["version_id"]) for item in result["versions"]] == [(selected, " v ")]
    assert [(item["key"], item["version_id"]) for item in result["delete_markers"]] == [(selected, " m ")]
    assert result["next_key_marker"] == " next +%2F "
    assert result["next_version_id_marker"] == " next version "
    assert result["is_truncated"] is True


@pytest.mark.parametrize("payload", [
    {}, {"keys": ["object"]}, {"columns": ["tags_count"]},
    {"keys": [], "columns": ["tags_count"]},
    {"keys": None, "columns": ["tags_count"]},
    {"keys": "object", "columns": ["tags_count"]},
    {"keys": [""], "columns": ["tags_count"]},
    {"keys": ["object", ""], "columns": ["tags_count"]},
    {"keys": [None], "columns": ["tags_count"]},
    {"keys": [123], "columns": ["tags_count"]},
    {"keys": [True], "columns": ["tags_count"]},
    {"keys": [{}], "columns": ["tags_count"]},
    {"keys": ["object"] * 201, "columns": ["tags_count"]},
    {"keys": ["object"], "columns": []},
    {"keys": ["object"], "columns": ["not_a_column"]},
    {"keys": ["object"], "columns": ["tags_count"] * 7},
])
def test_invalid_column_requests_fail_before_any_storage_read(client, storage, payload):
    response = client.post("/api/browser/buckets/target/objects/columns", json=payload)

    assert response.status_code == 422, response.text
    assert storage.mock_calls == []


def test_columns_accept_the_full_batch_limit_with_nonempty_opaque_keys(client, storage):
    keys = [f" key {index} " for index in range(200)]
    storage.get_object_tagging.return_value = {"TagSet": []}

    response = client.post("/api/browser/buckets/target/objects/columns", json={"keys": keys, "columns": ["tags_count"]})

    assert response.status_code == 200, response.text
    assert [item["key"] for item in response.json()["items"]] == keys
    assert [call.kwargs["Key"] for call in storage.get_object_tagging.call_args_list] == keys


@pytest.mark.parametrize("column,operation,status", [
    ("content_type", "head_object", "metadata_status"), ("tags_count", "get_object_tagging", "tags_status"),
])
def test_denied_column_reads_do_not_retry_a_normalized_key(client, storage, column, operation, status):
    getattr(storage, operation).side_effect = ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "denied"}}, operation,
    )

    response = client.post("/api/browser/buckets/target/objects/columns", json={
        "keys": [" report.txt "], "columns": [column],
    })

    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["key"] == " report.txt "
    assert item[status] == "error"
    getattr(storage, operation).assert_called_once_with(Bucket="target", Key=" report.txt ")


def test_empty_exact_version_key_never_falls_back_to_a_broad_listing(client, storage):
    response = client.get("/api/browser/buckets/target/versions", params={"key": "", "prefix": "unselected/"})

    assert response.status_code == 422, response.text
    storage.list_object_versions.assert_not_called()


@pytest.mark.parametrize("prefix", ["", " report/ ", " "])
def test_omitted_exact_version_key_preserves_prefix_wide_listing(client, storage, prefix):
    storage.list_object_versions.return_value = {
        "Versions": [{"Key": prefix + "one", "VersionId": "v1"}, {"Key": prefix + "two", "VersionId": "v2"}],
        "DeleteMarkers": [{"Key": prefix + "deleted", "VersionId": "m"}],
        "CommonPrefixes": [{"Prefix": prefix + "nested/"}],
    }

    response = client.get("/api/browser/buckets/target/versions", params={"prefix": prefix, "delimiter": "/"})

    assert response.status_code == 200, response.text
    storage.list_object_versions.assert_called_once_with(Bucket="target", Prefix=prefix, Delimiter="/", MaxKeys=1000)
    result = response.json()
    assert [item["key"] for item in result["versions"]] == [prefix + "one", prefix + "two"]
    assert [item["key"] for item in result["delete_markers"]] == [prefix + "deleted"]
    assert result["common_prefixes"] == [prefix + "nested/"]


def test_exact_version_listing_keeps_cursors_when_a_page_has_only_neighbor_keys(client, storage):
    selected = " report.txt "
    marker = selected + "neighbor"
    storage.list_object_versions.side_effect = [
        {"Versions": [{"Key": marker, "VersionId": "v1"}], "IsTruncated": True,
         "NextKeyMarker": marker, "NextVersionIdMarker": " v1 "},
        {"Versions": [{"Key": selected, "VersionId": " v2 "}], "IsTruncated": False},
    ]
    first = client.get("/api/browser/buckets/target/versions", params={"key": selected}).json()
    assert first["versions"] == []
    assert first["is_truncated"] is True
    assert first["next_key_marker"] == marker
    assert first["next_version_id_marker"] == " v1 "

    response = client.get("/api/browser/buckets/target/versions", params={
        "key": selected, "key_marker": first["next_key_marker"], "version_id_marker": first["next_version_id_marker"],
    })

    assert response.status_code == 200, response.text
    assert [(item["key"], item["version_id"]) for item in response.json()["versions"]] == [(selected, " v2 ")]
    storage.list_object_versions.assert_called_with(Bucket="target", Prefix=selected, MaxKeys=1000, KeyMarker=marker, VersionIdMarker=" v1 ")
