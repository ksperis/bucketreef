# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Any, Callable, TypeVar

from fastapi import status

from app.services.rgw_admin import RGWAdminError
from app.utils.cache import prune_expired_lru_cache
from app.utils.http_errors import raise_http_exception_from_exception


_T = TypeVar("_T")


@dataclass(frozen=True)
class EndpointListCacheKey:
    endpoint_id: int
    advanced_filter: str | None
    sort_by: str
    sort_dir: str


@dataclass(frozen=True)
class _EndpointPayloadCacheKey:
    endpoint_id: int


_K = TypeVar("_K", EndpointListCacheKey, _EndpointPayloadCacheKey)


@dataclass
class _EndpointCacheEntry:
    expires_at: float
    value: Any


class EndpointListingCache:
    """Own both identity-listing cache layers and invalidate their loads together."""

    def __init__(
        self,
        *,
        ttl_seconds: float = 30.0,
        payload_max_entries: int = 16,
        listing_max_entries: int = 64,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._payload_max_entries = payload_max_entries
        self._listing_max_entries = listing_max_entries
        self._payloads: OrderedDict[_EndpointPayloadCacheKey, _EndpointCacheEntry] = OrderedDict()
        self._listings: OrderedDict[EndpointListCacheKey, _EndpointCacheEntry] = OrderedDict()
        self._pending: dict[_EndpointPayloadCacheKey | EndpointListCacheKey, set[object]] = {}
        self._lock = Lock()

    def get_payload(self, endpoint_id: int, builder: Callable[[], list[Any]]) -> list[Any]:
        return self._get_or_set(
            self._payloads,
            _EndpointPayloadCacheKey(endpoint_id),
            self._payload_max_entries,
            builder,
        )

    def get_rgw_payload(self, endpoint_id: int, builder: Callable[[], list[Any] | None]) -> list[Any]:
        def load() -> list[Any]:
            try:
                payload = builder()
            except RGWAdminError as exc:
                raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
            return payload or []

        return self.get_payload(endpoint_id, load)

    def get_listing(self, key: EndpointListCacheKey, builder: Callable[[], list[_T]]) -> list[_T]:
        return self._get_or_set(self._listings, key, self._listing_max_entries, builder)

    def _get_or_set(
        self,
        cache: OrderedDict[_K, _EndpointCacheEntry],
        key: _K,
        max_entries: int,
        builder: Callable[[], _T],
    ) -> _T:
        with self._lock:
            prune_expired_lru_cache(cache, now=monotonic(), max_entries=max_entries)
            cached = cache.get(key)
            if cached is not None:
                cache.move_to_end(key)
                return cached.value
            load = object()
            self._pending.setdefault(key, set()).add(load)

        # Builders keep their own progress and cancellation callbacks. They must
        # not share another request's cancellation or failure through a future.
        try:
            value = builder()
            expires_at = monotonic() + self._ttl_seconds
            with self._lock:
                if load in self._pending.get(key, ()):
                    cache[key] = _EndpointCacheEntry(expires_at=expires_at, value=value)
                    cache.move_to_end(key)
                    prune_expired_lru_cache(cache, now=monotonic(), max_entries=max_entries)
            return value
        finally:
            with self._lock:
                pending = self._pending.get(key)
                if pending is not None:
                    pending.discard(load)
                    if not pending:
                        self._pending.pop(key, None)

    def invalidate(self, endpoint_id: int | None = None) -> None:
        with self._lock:
            for entries in (self._payloads, self._listings, self._pending):
                if endpoint_id is None:
                    entries.clear()
                else:
                    keys = [key for key in entries if key.endpoint_id == endpoint_id]
                    for key in keys:
                        entries.pop(key, None)
