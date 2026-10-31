# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable, Protocol, TypeVar

from app.models.ceph_admin_identity_filters import CephAdminFilterMatch
from app.services.listing_progress import ListingProgressEmitter, emit_listing_ready
from app.utils.cancellation import invoke_cancel_check


_T = TypeVar("_T")
_R = TypeVar("_R")
_Response = TypeVar("_Response")


class _FilterRule(Protocol):
    @property
    def field(self) -> str: ...


_FieldRule = TypeVar("_FieldRule", bound=_FilterRule)


class _FilterQuery(Protocol[_R]):
    @property
    def rules(self) -> list[_R]: ...

    @property
    def match(self) -> CephAdminFilterMatch: ...


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


def collect_filter_fields(parsed_filter: _FilterQuery[_FieldRule] | None) -> set[str]:
    if parsed_filter is None or not parsed_filter.rules:
        return set()
    return {rule.field for rule in parsed_filter.rules if rule.field}


def apply_advanced_filter(
    items: list[_T],
    parsed_filter: _FilterQuery[_R] | None,
    rule_matcher: Callable[[_T, _R], bool],
) -> list[_T]:
    if parsed_filter is None or not parsed_filter.rules:
        return items
    match_all = parsed_filter.match == "all"
    return [
        item
        for item in items
        if (
            all(rule_matcher(item, rule) for rule in parsed_filter.rules)
            if match_all
            else any(rule_matcher(item, rule) for rule in parsed_filter.rules)
        )
    ]


def apply_simple_search(
    items: list[_T],
    *,
    search: str | None,
    parsed_filter: object | None,
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


def run_identity_listing_pipeline(
    *,
    progress: ListingProgressEmitter,
    cancel_check: Callable[[], None] | None,
    prepare_query: Callable[[], None],
    load_results: Callable[[], list[_T]],
    search_results: Callable[[list[_T]], list[_T]],
    page: int,
    page_size: int,
    clone: Callable[[list[_T]], list[_T]],
    enrich_page: Callable[[list[_T]], list[_T]],
    build_response: Callable[[list[_T], int, bool], _Response],
) -> _Response:
    progress.emit(
        percent=0,
        stage="prepare",
        message="Preparing advanced search",
        force=True,
    )
    invoke_cancel_check(cancel_check)
    prepare_query()

    results = load_results()
    emit_listing_ready(
        progress,
        item_count=len(results),
        cancel_check=cancel_check,
    )
    filtered_results = search_results(results)
    page_items, total, has_next = paginate_listing_results(
        filtered_results,
        page=page,
        page_size=page_size,
        clone=clone,
        progress=progress,
        cancel_check=cancel_check,
    )
    page_items = enrich_page(page_items)
    progress.emit(
        percent=100,
        stage="finalize",
        processed=total,
        total=total,
        message="Search completed",
        force=True,
    )
    return build_response(page_items, total, has_next)
