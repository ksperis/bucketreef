# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Callable

from app.models.bucket import Bucket
from app.services.s3_execution_client import s3_execution_cache_key
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.utils.cache import TtlCacheEntry, get_or_build_single_flight_cache

BUCKET_LISTING_CACHE_TTL_SECONDS = 1800.0
BUCKET_LISTING_CACHE_MAX_ENTRIES = 512


@dataclass(frozen=True)
class BucketListingCacheKey:
    scope_key: str
    execution_key: str
    include_key: str
    with_stats: bool


_BUCKET_LISTING_CACHE: OrderedDict[BucketListingCacheKey, TtlCacheEntry[list[Bucket]]] = OrderedDict()
_BUCKET_LISTING_CACHE_LOCK = Lock()
_BUCKET_LISTING_INFLIGHT: dict[BucketListingCacheKey, Future[list[Bucket]]] = {}


def _clone_bucket(item: Bucket) -> Bucket:
    return item.model_copy(deep=True)


def _clone_bucket_list(items: list[Bucket]) -> list[Bucket]:
    return [_clone_bucket(item) for item in items]


def _normalize_include_key(include: set[str]) -> str:
    if not include:
        return ""
    normalized = sorted({str(item).strip() for item in include if str(item).strip()})
    return ",".join(normalized)


def _context_scope_key(context: S3ExecutionTarget) -> str:
    """Invalidate all execution variants of the explicitly selected resource."""
    return context.context_id if isinstance(context, S3ExecutionContext) else str(context.id)


def get_cached_bucket_listing_for_context(
    *,
    context: S3ExecutionTarget,
    include: set[str],
    with_stats: bool,
    builder: Callable[[], list[Bucket]],
) -> list[Bucket]:
    key = BucketListingCacheKey(
        scope_key=_context_scope_key(context),
        execution_key=s3_execution_cache_key(context),
        include_key=_normalize_include_key(include),
        with_stats=bool(with_stats),
    )
    return get_or_build_single_flight_cache(
        _BUCKET_LISTING_CACHE,
        _BUCKET_LISTING_INFLIGHT,
        _BUCKET_LISTING_CACHE_LOCK,
        key,
        builder=builder,
        ttl_seconds=BUCKET_LISTING_CACHE_TTL_SECONDS,
        max_entries=BUCKET_LISTING_CACHE_MAX_ENTRIES,
        clone_value=_clone_bucket_list,
        future_factory=Future,
        clock=monotonic,
    )


def invalidate_bucket_listing_cache(scope_key: str | None = None) -> None:
    with _BUCKET_LISTING_CACHE_LOCK:
        for entries in (_BUCKET_LISTING_CACHE, _BUCKET_LISTING_INFLIGHT):
            if scope_key is None:
                entries.clear()
            else:
                invalid_keys = [key for key in entries if key.scope_key == scope_key]
                for key in invalid_keys:
                    entries.pop(key, None)


def invalidate_bucket_listing_cache_for_context(context: S3ExecutionTarget) -> None:
    invalidate_bucket_listing_cache(_context_scope_key(context))
