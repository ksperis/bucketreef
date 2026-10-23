# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.browser import (
    BrowserObjectVersion,
    CleanupObjectVersionsResponse,
    ListBrowserObjectsResponse,
    ListMultipartUploadsResponse,
    ListObjectVersionsResponse,
    MultipartUploadItem,
    ObjectMetadata,
    ObjectColumnsResponse,
    PaginatedBrowserBucketsResponse,
    PresignedUrl,
    PresignPartResponse,
    StsStatus,
)


def test_browser_list_responses_require_complete_canonical_payloads() -> None:
    assert set(PaginatedBrowserBucketsResponse.model_json_schema()["required"]) == {
        "items",
        "total",
        "page",
        "page_size",
        "has_next",
    }
    assert set(ListBrowserObjectsResponse.model_json_schema()["required"]) == {
        "prefix",
        "objects",
        "prefixes",
        "is_truncated",
        "next_continuation_token",
    }
    assert set(ObjectColumnsResponse.model_json_schema()["required"]) == {"items"}


def test_browser_object_response_models_require_complete_canonical_payloads() -> None:
    assert set(BrowserObjectVersion.model_json_schema()["required"]) == {
        "key",
        "version_id",
        "is_latest",
        "is_delete_marker",
        "last_modified",
        "size",
        "etag",
        "storage_class",
    }
    assert set(ListObjectVersionsResponse.model_json_schema()["required"]) == {
        "prefix",
        "common_prefixes",
        "versions",
        "delete_markers",
        "is_truncated",
        "key_marker",
        "version_id_marker",
        "next_key_marker",
        "next_version_id_marker",
    }
    assert set(ObjectMetadata.model_json_schema()["required"]) == {
        "key",
        "size",
        "etag",
        "last_modified",
        "content_type",
        "cache_control",
        "content_disposition",
        "content_encoding",
        "content_language",
        "expires",
        "storage_class",
        "restore_status",
        "metadata",
        "version_id",
    }
    assert set(MultipartUploadItem.model_json_schema()["required"]) == {
        "key",
        "upload_id",
        "initiated",
        "storage_class",
        "owner",
    }
    assert set(ListMultipartUploadsResponse.model_json_schema()["required"]) == {
        "uploads",
        "is_truncated",
        "next_key",
        "next_upload_id",
    }
    assert set(PresignedUrl.model_json_schema()["required"]) == {
        "url",
        "method",
        "expires_in",
        "headers",
    }
    assert set(PresignPartResponse.model_json_schema()["required"]) == {
        "url",
        "method",
        "expires_in",
        "headers",
    }
    assert set(CleanupObjectVersionsResponse.model_json_schema()["required"]) == {
        "prefix",
        "deleted_versions",
        "deleted_delete_markers",
        "scanned_versions",
        "scanned_delete_markers",
    }


def test_browser_sts_status_requires_explicit_error_state() -> None:
    assert set(StsStatus.model_json_schema()["required"]) == {"available", "error"}
