# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import Callable, Generic, Protocol, TypeVar


class ExpiringCacheEntry(Protocol):
    expires_at: float


_KeyT = TypeVar("_KeyT")
_EntryT = TypeVar("_EntryT", bound=ExpiringCacheEntry)
_ValueT = TypeVar("_ValueT")


@dataclass
class TtlCacheEntry(Generic[_ValueT]):
    expires_at: float
    value: _ValueT


def prune_expired_lru_cache(
    cache: OrderedDict[_KeyT, _EntryT],
    *,
    now: float,
    max_entries: int,
) -> None:
    expired = [key for key, entry in cache.items() if entry.expires_at <= now]
    for key in expired:
        cache.pop(key, None)
    while len(cache) > max_entries:
        cache.popitem(last=False)


def get_or_build_single_flight_cache(
    cache: OrderedDict[_KeyT, TtlCacheEntry[_ValueT]],
    inflight: dict[_KeyT, Future[_ValueT]],
    lock: Lock,
    key: _KeyT,
    *,
    builder: Callable[[], _ValueT],
    ttl_seconds: float,
    max_entries: int,
    clone_value: Callable[[_ValueT], _ValueT] | None = None,
    future_factory: Callable[[], Future[_ValueT]] = Future,
    clock: Callable[[], float] = monotonic,
) -> _ValueT:
    """Return a TTL/LRU cached value while coalescing concurrent misses per key.

    Invalidating a key is handled by removing its future from ``inflight``.
    A detached owner still completes for callers already waiting on that future,
    but its result cannot repopulate the cache or displace a newer generation.
    """

    def clone(value: _ValueT) -> _ValueT:
        return clone_value(value) if clone_value is not None else value

    is_owner = False
    with lock:
        prune_expired_lru_cache(cache, now=clock(), max_entries=max_entries)
        cached = cache.get(key)
        if cached is not None:
            cache.move_to_end(key)
            return clone(cached.value)
        future = inflight.get(key)
        if future is None:
            future = future_factory()
            inflight[key] = future
            is_owner = True

    if not is_owner:
        return clone(future.result())

    try:
        value = clone(builder())
        with lock:
            if inflight.get(key) is future:
                cache[key] = TtlCacheEntry(
                    expires_at=clock() + ttl_seconds,
                    value=value,
                )
                cache.move_to_end(key)
                prune_expired_lru_cache(cache, now=clock(), max_entries=max_entries)
        future.set_result(value)
        return clone(value)
    except BaseException as exc:
        future.set_exception(exc)
        raise
    finally:
        with lock:
            if inflight.get(key) is future:
                inflight.pop(key, None)


def invalidate_single_flight_cache(
    cache: OrderedDict[_KeyT, TtlCacheEntry[_ValueT]],
    inflight: dict[_KeyT, Future[_ValueT]],
    lock: Lock,
    *,
    predicate: Callable[[_KeyT], bool] | None = None,
) -> None:
    """Detach matching cached and in-flight generations under the same lock."""
    with lock:
        if predicate is None:
            cache.clear()
            inflight.clear()
            return
        for entries in (cache, inflight):
            invalid_keys = [key for key in entries if predicate(key)]
            for key in invalid_keys:
                entries.pop(key, None)
