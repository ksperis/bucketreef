# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, TypeVar

from app.services.listing_progress import ListingProgressEmitter, invoke_cancel_check


_T = TypeVar("_T")
_R = TypeVar("_R")


def coerce_number(value: object) -> float | None:
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def collect_filter_fields(parsed_filter: Any | None) -> set[str]:
    if not parsed_filter:
        return set()
    rules = getattr(parsed_filter, "rules", None)
    if not rules:
        return set()
    return {rule.field for rule in rules if getattr(rule, "field", None)}


def apply_advanced_filter(
    items: list[_T],
    parsed_filter: Any | None,
    matcher: Callable[[_T, list[_R], str], bool],
) -> list[_T]:
    if not parsed_filter:
        return items
    rules = getattr(parsed_filter, "rules", None)
    if not rules:
        return items
    match_mode = getattr(parsed_filter, "match", "all")
    return [item for item in items if matcher(item, rules, match_mode)]


def apply_simple_search(
    items: list[_T],
    *,
    search: str | None,
    parsed_filter: Any | None,
    match_with_filter: Callable[[_T, str], bool],
    match_without_filter: Callable[[_T, str], bool],
) -> list[_T]:
    if not isinstance(search, str):
        return items
    normalized = search.strip().lower()
    if not normalized:
        return items
    if parsed_filter:
        return [item for item in items if match_with_filter(item, normalized)]
    return [item for item in items if match_without_filter(item, normalized)]


def paginate(
    items: list[_T],
    *,
    page: int,
    page_size: int,
    clone: Callable[[list[_T]], list[_T]],
) -> tuple[list[_T], int, bool]:
    total = len(items)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    page_items = clone(items[start:end])
    return page_items, total, end < total


def paginate_listing_results(
    items: list[_T],
    *,
    page: int,
    page_size: int,
    clone: Callable[[list[_T]], list[_T]],
    progress: ListingProgressEmitter,
    cancel_check: Callable[[], None] | None,
) -> tuple[list[_T], int, bool]:
    progress.emit(
        percent=85,
        stage="paginate",
        processed=len(items),
        total=len(items),
        message="Preparing result page",
        force=True,
    )
    invoke_cancel_check(cancel_check)
    return paginate(
        items,
        page=page,
        page_size=page_size,
        clone=clone,
    )
