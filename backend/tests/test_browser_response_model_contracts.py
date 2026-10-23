# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.browser import (
    ListBrowserObjectsResponse,
    ObjectColumnsResponse,
    PaginatedBrowserBucketsResponse,
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
