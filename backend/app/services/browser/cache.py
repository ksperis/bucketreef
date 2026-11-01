# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from threading import Lock
from time import monotonic
from typing import Callable, Generic, Optional, TypeVar

from app.models.browser import BrowserBucket, ListBrowserObjectsResponse

from .sorted_listing import SortedObjectSnapshot

logger = logging.getLogger(__name__)

BUCKET_LIST_CACHE_TTL_SECONDS = 30
BUCKET_LIST_CACHE_MAX_ENTRIES = 64
OBJECT_LIST_CACHE_TTL_SECONDS = 10
OBJECT_LIST_CACHE_MAX_ENTRIES = 512
OBJECT_SORT_SNAPSHOT_CACHE_MAX_ENTRIES = 128
OBJECT_LAZY_COLUMN_CACHE_TTL_SECONDS = 15
OBJECT_LAZY_COLUMN_CACHE_MAX_ENTRIES = 2048

_CacheKey = TypeVar("_CacheKey")
_CacheValue = TypeVar("_CacheValue")


@dataclass
class _TtlLruCacheEntry(Generic[_CacheValue]):
    value: _CacheValue
    expires_at: float


class _TtlLruCache(Generic[_CacheKey, _CacheValue]):
    def __init__(
        self,
        max_entries: int,
        ttl_seconds: int,
        *,
        on_evict: Optional[Callable[[_CacheValue], None]] = None,
    ) -> None:
        self._max_entries = max_entries
        self._ttl_seconds = float(ttl_seconds)
        self._store: OrderedDict[_CacheKey, _TtlLruCacheEntry[_CacheValue]] = OrderedDict()
        self._lock = Lock()
        self._on_evict = on_evict

    def _evict_entry(self, entry: _TtlLruCacheEntry[_CacheValue]) -> None:
        if self._on_evict is None:
            return
        try:
            self._on_evict(entry.value)
        except Exception:  # noqa: BLE001
            logger.debug("Cache eviction cleanup failed", exc_info=True)

    def get(self, key: _CacheKey) -> Optional[_CacheValue]:
        now = monotonic()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                del self._store[key]
                self._evict_entry(entry)
                return None
            self._store.move_to_end(key)
            return entry.value

    def set(self, key: _CacheKey, value: _CacheValue) -> None:
        expires_at = monotonic() + self._ttl_seconds
        with self._lock:
            previous = self._store.get(key)
            if previous is not None:
                self._evict_entry(previous)
            self._store[key] = _TtlLruCacheEntry(value=value, expires_at=expires_at)
            self._store.move_to_end(key)
            while len(self._store) > self._max_entries:
                _, evicted = self._store.popitem(last=False)
                self._evict_entry(evicted)

    def invalidate_where(self, predicate: Callable[[_CacheKey], bool]) -> int:
        removed = 0
        with self._lock:
            keys_to_remove = [key for key in self._store.keys() if predicate(key)]
            for key in keys_to_remove:
                entry = self._store.pop(key, None)
                if entry is not None:
                    self._evict_entry(entry)
                removed += 1
        return removed


@dataclass(frozen=True)
class ObjectLazyHeadCacheValue:
    content_type: Optional[str]
    metadata_count: Optional[int]
    cache_control: Optional[str]
    expires: Optional[datetime]
    restore_status: Optional[str]
    available: bool


@dataclass(frozen=True)
class ObjectLazyTagsCacheValue:
    tags_count: Optional[int]
    available: bool


BUCKET_LIST_CACHE: _TtlLruCache[str, list[BrowserBucket]] = _TtlLruCache(
    max_entries=BUCKET_LIST_CACHE_MAX_ENTRIES,
    ttl_seconds=BUCKET_LIST_CACHE_TTL_SECONDS,
)
OBJECT_LIST_CACHE: _TtlLruCache[tuple, ListBrowserObjectsResponse] = _TtlLruCache(
    max_entries=OBJECT_LIST_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LIST_CACHE_TTL_SECONDS,
)
OBJECT_SORT_SNAPSHOT_CACHE: _TtlLruCache[tuple, SortedObjectSnapshot] = _TtlLruCache(
    max_entries=OBJECT_SORT_SNAPSHOT_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LIST_CACHE_TTL_SECONDS,
    on_evict=lambda snapshot: snapshot.close(),
)
OBJECT_LAZY_HEAD_CACHE: _TtlLruCache[tuple, ObjectLazyHeadCacheValue] = _TtlLruCache(
    max_entries=OBJECT_LAZY_COLUMN_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LAZY_COLUMN_CACHE_TTL_SECONDS,
)
OBJECT_LAZY_TAGS_CACHE: _TtlLruCache[tuple, ObjectLazyTagsCacheValue] = _TtlLruCache(
    max_entries=OBJECT_LAZY_COLUMN_CACHE_MAX_ENTRIES,
    ttl_seconds=OBJECT_LAZY_COLUMN_CACHE_TTL_SECONDS,
)
