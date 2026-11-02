# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Callable
from typing import Any


IAMPageMatcher = Callable[[dict, str], bool]


def list_iam_all(client: Any, operation_name: str, result_key: str, **kwargs) -> list[Any]:
    items: list[Any] = []
    marker: str | None = None
    seen_markers: set[str] = set()
    while True:
        request = dict(kwargs)
        if marker is not None:
            request["Marker"] = marker
        response = getattr(client, operation_name)(**request)
        items.extend(response.get(result_key, []) or [])
        if not response.get("IsTruncated"):
            return items
        next_marker = response.get("Marker")
        if not isinstance(next_marker, str) or not next_marker or next_marker in seen_markers:
            raise RuntimeError(
                f"IAM pagination for {operation_name} returned IsTruncated without a usable Marker"
            )
        seen_markers.add(next_marker)
        marker = next_marker


def list_iam_page(
    client: Any,
    operation_name: str,
    result_key: str,
    *,
    marker: str | None = None,
    max_items: int = 25,
    search: str | None = None,
    matcher: IAMPageMatcher | None = None,
    max_requests: int = 20,
    **kwargs,
) -> tuple[list[Any], str | None]:
    """Return a bounded IAM page without materializing the full RGW catalog."""
    items: list[Any] = []
    current_marker = marker
    needle = (search or "").strip().lower()
    request_count = 0
    seen_markers: set[str] = set()
    while len(items) < max_items and request_count < max_requests:
        request = dict(kwargs)
        request["MaxItems"] = max(1, max_items - len(items))
        if current_marker:
            request["Marker"] = current_marker
        response = getattr(client, operation_name)(**request)
        request_count += 1
        page_items = response.get(result_key, []) or []
        if needle and matcher is not None:
            page_items = [item for item in page_items if matcher(item, needle)]
        items.extend(page_items)
        if not response.get("IsTruncated"):
            return items[:max_items], None
        next_marker = response.get("Marker")
        if not isinstance(next_marker, str) or not next_marker or next_marker in seen_markers:
            raise RuntimeError(
                f"IAM pagination for {operation_name} returned IsTruncated without a usable Marker"
            )
        seen_markers.add(next_marker)
        current_marker = next_marker
    return items[:max_items], current_marker


def iam_matches_fields(data: dict, needle: str, *fields: str) -> bool:
    return any(needle in str(data.get(field) or "").lower() for field in fields)
