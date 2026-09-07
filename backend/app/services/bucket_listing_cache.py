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
from app.utils.cache import prune_expired_lru_cache

BUCKET_LISTING_CACHE_TTL_SECONDS = 1800.0
BUCKET_LISTING_CACHE_MAX_ENTRIES = 512


@dataclass(frozen=True)
class BucketListingCacheKey:
    scope_key: str
    execution_key: str
    include_key: str
    with_stats: bool


@dataclass
class BucketListingCacheEntry:
    expires_at: float
    items: list[Bucket]


_BUCKET_LISTING_CACHE: OrderedDict[BucketListingCacheKey, BucketListingCacheEntry] = OrderedDict()
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


def _account_scope_key(account: S3ExecutionTarget) -> str:
    """Invalidate all execution variants of the explicitly selected resource."""
    return account.context_id if isinstance(account, S3ExecutionContext) else str(account.id)


def get_cached_bucket_listing_for_account(
    *,
    account: S3ExecutionTarget,
    include: set[str],
    with_stats: bool,
    builder: Callable[[], list[Bucket]],
) -> list[Bucket]:
    key = BucketListingCacheKey(
        scope_key=_account_scope_key(account),
        execution_key=s3_execution_cache_key(account),
        include_key=_normalize_include_key(include),
        with_stats=bool(with_stats),
    )
    now = monotonic()
    is_owner = False
    in_flight: Future[list[Bucket]] | None = None
    with _BUCKET_LISTING_CACHE_LOCK:
        prune_expired_lru_cache(
            _BUCKET_LISTING_CACHE,
            now=now,
            max_entries=BUCKET_LISTING_CACHE_MAX_ENTRIES,
        )
        cached = _BUCKET_LISTING_CACHE.get(key)
        if cached is not None:
            _BUCKET_LISTING_CACHE.move_to_end(key)
            return _clone_bucket_list(cached.items)
        in_flight = _BUCKET_LISTING_INFLIGHT.get(key)
        if in_flight is None:
            in_flight = Future()
            _BUCKET_LISTING_INFLIGHT[key] = in_flight
            is_owner = True

    if not is_owner:
        return _clone_bucket_list(in_flight.result())

    try:
        items = builder()
        cached_items = _clone_bucket_list(items)
        expires_at = monotonic() + BUCKET_LISTING_CACHE_TTL_SECONDS
        with _BUCKET_LISTING_CACHE_LOCK:
            # An invalidated load may finish for its original callers, but must
            # neither repopulate the cache nor replace a newer load's result.
            if _BUCKET_LISTING_INFLIGHT.get(key) is in_flight:
                _BUCKET_LISTING_CACHE[key] = BucketListingCacheEntry(
                    expires_at=expires_at,
                    items=cached_items,
                )
                _BUCKET_LISTING_CACHE.move_to_end(key)
                prune_expired_lru_cache(
                    _BUCKET_LISTING_CACHE,
                    now=monotonic(),
                    max_entries=BUCKET_LISTING_CACHE_MAX_ENTRIES,
                )
        in_flight.set_result(cached_items)
        return _clone_bucket_list(cached_items)
    except Exception as exc:
        in_flight.set_exception(exc)
        raise
    finally:
        with _BUCKET_LISTING_CACHE_LOCK:
            if _BUCKET_LISTING_INFLIGHT.get(key) is in_flight:
                _BUCKET_LISTING_INFLIGHT.pop(key, None)


def invalidate_bucket_listing_cache(scope_key: str | None = None) -> None:
    with _BUCKET_LISTING_CACHE_LOCK:
        for entries in (_BUCKET_LISTING_CACHE, _BUCKET_LISTING_INFLIGHT):
            if scope_key is None:
                entries.clear()
            else:
                invalid_keys = [key for key in entries if key.scope_key == scope_key]
                for key in invalid_keys:
                    entries.pop(key, None)


def invalidate_bucket_listing_cache_for_account(account: S3ExecutionTarget) -> None:
    invalidate_bucket_listing_cache(_account_scope_key(account))
