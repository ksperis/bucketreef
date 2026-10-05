# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock
from time import monotonic
from typing import Callable

from app.utils.cache import prune_expired_lru_cache

DASHBOARD_METRICS_TTL_SECONDS = 1800
DASHBOARD_METRICS_FAILURE_TTL_SECONDS = 60
DASHBOARD_METRICS_MAX_ENTRIES = 64


@dataclass
class DashboardMetricsCacheEntry:
    expires_at: float
    expires_at_utc: str
    payload: dict


_CACHE: OrderedDict[tuple[str, str], DashboardMetricsCacheEntry] = OrderedDict()
_INFLIGHT: dict[tuple[str, str], Future[DashboardMetricsCacheEntry]] = {}
_LOCK = Lock()


def _response(entry: DashboardMetricsCacheEntry, *, hit: bool) -> dict:
    return {**deepcopy(entry.payload), "cache": {"hit": hit, "expires_at": entry.expires_at_utc}}


def get_cached_dashboard_metrics(kind: str, fingerprint: str, builder: Callable[[], dict]) -> dict:
    key = (kind, fingerprint)
    owner = False
    with _LOCK:
        prune_expired_lru_cache(_CACHE, now=monotonic(), max_entries=DASHBOARD_METRICS_MAX_ENTRIES)
        cached = _CACHE.get(key)
        if cached is not None:
            _CACHE.move_to_end(key)
        else:
            future = _INFLIGHT.get(key)
            if future is None:
                future = Future()
                _INFLIGHT[key] = future
                owner = True
    # Copying responses and waiting for RGW collection never hold the lock.
    if cached is not None:
        return _response(cached, hit=True)
    if not owner:
        return _response(future.result(), hit=True)
    try:
        payload = builder()
        coverage = payload["coverage"]
        ttl = (
            DASHBOARD_METRICS_FAILURE_TTL_SECONDS
            if coverage["eligible_count"] > 0 and coverage["contributing_count"] == 0
            else DASHBOARD_METRICS_TTL_SECONDS
        )
        entry = DashboardMetricsCacheEntry(
            expires_at=monotonic() + ttl,
            expires_at_utc=(datetime.now(timezone.utc) + timedelta(seconds=ttl)).isoformat(),
            payload=deepcopy(payload),
        )
        with _LOCK:
            # A reset must not allow an older collection to repopulate the cache.
            if _INFLIGHT.get(key) is future:
                _CACHE[key] = entry
                _CACHE.move_to_end(key)
                prune_expired_lru_cache(_CACHE, now=monotonic(), max_entries=DASHBOARD_METRICS_MAX_ENTRIES)
        future.set_result(entry)
        return _response(entry, hit=False)
    except Exception as exc:
        future.set_exception(exc)
        raise
    finally:
        with _LOCK:
            if _INFLIGHT.get(key) is future:
                _INFLIGHT.pop(key, None)


def reset_dashboard_metrics_cache() -> None:
    with _LOCK:
        _CACHE.clear()
        _INFLIGHT.clear()
