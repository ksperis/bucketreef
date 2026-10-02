# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from threading import Event, Lock
from time import monotonic
from typing import Callable

from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_listing_owner_metadata import BucketListingAdminContext
from app.services.bucket_owner_enrichment import BucketOwnerUsage
from app.utils.cache import prune_expired_lru_cache
from app.utils.rgw_payloads import extract_bucket_list


BUCKET_LIST_CACHE_TTL_SECONDS = 1800.0
BUCKET_LIST_CACHE_MAX_ENTRIES = 64
RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES = 16


@dataclass(frozen=True)
class CephAdminBucketListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str
    with_stats: bool
    with_owner_metadata: bool
    with_owner_usage: bool


@dataclass
class CephAdminBucketListingSnapshot:
    items: list[BucketListingSummary]
    stats_available: bool = True
    stats_warning: str | None = None
    owner_usage_by_key: dict[str, BucketOwnerUsage] | None = None


@dataclass
class _BucketListCacheEntry:
    expires_at: float
    listing: CephAdminBucketListingSnapshot


@dataclass(frozen=True)
class _RgwBucketPayloadCacheKey:
    endpoint_id: int
    with_stats: bool


@dataclass
class _RgwBucketPayloadCacheEntry:
    expires_at: float
    entries: list[dict]


_BUCKET_LIST_CACHE: OrderedDict[CephAdminBucketListCacheKey, _BucketListCacheEntry] = OrderedDict()
_BUCKET_LIST_INFLIGHT: dict[CephAdminBucketListCacheKey, Future[CephAdminBucketListingSnapshot]] = {}
_RGW_BUCKET_PAYLOAD_CACHE: OrderedDict[_RgwBucketPayloadCacheKey, _RgwBucketPayloadCacheEntry] = OrderedDict()
_RGW_BUCKET_PAYLOAD_INFLIGHT: dict[int, Event] = {}
# Both cache layers must be invalidated together. No provider call or wait
# holds this lock; payload requests remain serialized per endpoint and load.
_CACHE_LOCK = Lock()


def clone_ceph_admin_bucket_list(items: list[BucketListingSummary]) -> list[BucketListingSummary]:
    return [item.model_copy(deep=True) for item in items]


def _cached_rgw_bucket_entries_locked(key: _RgwBucketPayloadCacheKey) -> list[dict] | None:
    """Read a compatible payload while the caller holds the shared cache lock."""
    prune_expired_lru_cache(
        _RGW_BUCKET_PAYLOAD_CACHE,
        now=monotonic(),
        max_entries=RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES,
    )
    cached = _RGW_BUCKET_PAYLOAD_CACHE.get(key)
    if cached is not None:
        _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(key)
        return cached.entries

    if not key.with_stats:
        stats_key = _RgwBucketPayloadCacheKey(endpoint_id=key.endpoint_id, with_stats=True)
        cached_stats = _RGW_BUCKET_PAYLOAD_CACHE.get(stats_key)
        if cached_stats is not None:
            _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(stats_key)
            return cached_stats.entries
    return None


def get_cached_rgw_bucket_entries(ctx: BucketListingAdminContext, with_stats: bool) -> list[dict]:
    endpoint_id = ctx.endpoint.id
    key = _RgwBucketPayloadCacheKey(endpoint_id=endpoint_id, with_stats=with_stats)
    while True:
        with _CACHE_LOCK:
            cached = _cached_rgw_bucket_entries_locked(key)
            if cached is not None:
                return cached
            in_flight = _RGW_BUCKET_PAYLOAD_INFLIGHT.get(endpoint_id)
            if in_flight is None:
                in_flight = Event()
                _RGW_BUCKET_PAYLOAD_INFLIGHT[endpoint_id] = in_flight
                break
        # Recheck after the preceding request, including when it failed or
        # returned a payload without the statistics this caller needs.
        in_flight.wait()

    try:
        payload = ctx.rgw_admin.get_all_buckets(with_stats=with_stats)
        entries = extract_bucket_list(payload)
        expires_at = monotonic() + BUCKET_LIST_CACHE_TTL_SECONDS
        with _CACHE_LOCK:
            if _RGW_BUCKET_PAYLOAD_INFLIGHT.get(endpoint_id) is in_flight:
                _RGW_BUCKET_PAYLOAD_CACHE[key] = _RgwBucketPayloadCacheEntry(
                    expires_at=expires_at,
                    entries=entries,
                )
                _RGW_BUCKET_PAYLOAD_CACHE.move_to_end(key)
                prune_expired_lru_cache(
                    _RGW_BUCKET_PAYLOAD_CACHE,
                    now=monotonic(),
                    max_entries=RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES,
                )
        return entries
    finally:
        with _CACHE_LOCK:
            if _RGW_BUCKET_PAYLOAD_INFLIGHT.get(endpoint_id) is in_flight:
                _RGW_BUCKET_PAYLOAD_INFLIGHT.pop(endpoint_id, None)
        in_flight.set()


def get_cached_bucket_listing(
    key: CephAdminBucketListCacheKey,
    builder: Callable[[], CephAdminBucketListingSnapshot],
) -> CephAdminBucketListingSnapshot:
    now = monotonic()
    is_owner = False
    with _CACHE_LOCK:
        prune_expired_lru_cache(
            _BUCKET_LIST_CACHE,
            now=now,
            max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
        )
        cached = _BUCKET_LIST_CACHE.get(key)
        if cached is not None:
            _BUCKET_LIST_CACHE.move_to_end(key)
            return cached.listing
        in_flight = _BUCKET_LIST_INFLIGHT.get(key)
        if in_flight is None:
            in_flight = Future()
            _BUCKET_LIST_INFLIGHT[key] = in_flight
            is_owner = True

    if not is_owner:
        return in_flight.result()

    try:
        listing = builder()
        expires_at = monotonic() + BUCKET_LIST_CACHE_TTL_SECONDS
        with _CACHE_LOCK:
            if _BUCKET_LIST_INFLIGHT.get(key) is in_flight:
                _BUCKET_LIST_CACHE[key] = _BucketListCacheEntry(
                    expires_at=expires_at,
                    listing=listing,
                )
                _BUCKET_LIST_CACHE.move_to_end(key)
                prune_expired_lru_cache(
                    _BUCKET_LIST_CACHE,
                    now=monotonic(),
                    max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
                )
        in_flight.set_result(listing)
        return listing
    except Exception as exc:
        in_flight.set_exception(exc)
        raise
    finally:
        with _CACHE_LOCK:
            if _BUCKET_LIST_INFLIGHT.get(key) is in_flight:
                _BUCKET_LIST_INFLIGHT.pop(key, None)


def invalidate_bucket_listing_cache(endpoint_id: int) -> None:
    with _CACHE_LOCK:
        for entries in (_BUCKET_LIST_CACHE, _BUCKET_LIST_INFLIGHT, _RGW_BUCKET_PAYLOAD_CACHE):
            invalid_keys = [key for key in entries if key.endpoint_id == endpoint_id]
            for key in invalid_keys:
                entries.pop(key, None)
        _RGW_BUCKET_PAYLOAD_INFLIGHT.pop(endpoint_id, None)


def reset_ceph_admin_bucket_listing_caches_for_tests() -> None:
    with _CACHE_LOCK:
        _BUCKET_LIST_CACHE.clear()
        _BUCKET_LIST_INFLIGHT.clear()
        _RGW_BUCKET_PAYLOAD_CACHE.clear()
        _RGW_BUCKET_PAYLOAD_INFLIGHT.clear()
