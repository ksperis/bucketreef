# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import ceph_admin_identity_listing_cache
from app.services.ceph_admin_identity_listing_cache import (
    EndpointListCacheKey,
    EndpointListingCache,
    get_cached_accounts_listing,
    get_cached_rgw_accounts_payload,
    get_cached_rgw_users_payload,
    get_cached_users_listing,
    invalidate_accounts_listing_cache,
    invalidate_users_listing_cache,
)
from app.services.listing_progress import ListingCancelled
from app.services.rgw_admin import RGWAdminError


@pytest.fixture(params=["accounts", "users"])
def cache_api(request):
    if request.param == "accounts":
        api = SimpleNamespace(
            payload=get_cached_rgw_accounts_payload,
            listing=get_cached_accounts_listing,
            invalidate=invalidate_accounts_listing_cache,
        )
    else:
        api = SimpleNamespace(
            payload=get_cached_rgw_users_payload,
            listing=get_cached_users_listing,
            invalidate=invalidate_users_listing_cache,
        )
    api.invalidate()
    yield api
    api.invalidate()


def _read(api, layer, builder, endpoint_id=17):
    if layer == "payload":
        return api.payload(endpoint_id, builder)
    key = EndpointListCacheKey(endpoint_id, None, "name", "asc")
    if layer == "combined":
        return api.listing(key, lambda: api.payload(endpoint_id, builder))
    return api.listing(key, builder)


@pytest.mark.parametrize("layer", ["payload", "listing", "combined"])
@pytest.mark.parametrize("reset_all", [False, True])
@pytest.mark.parametrize("old_finishes_first", [False, True])
def test_invalidation_prevents_old_load_from_restoring_cache(cache_api, layer, reset_all, old_finishes_first):
    started = Event()
    finish = Event()
    fresh_started = Event()
    finish_fresh = Event()
    calls = []

    def old_builder():
        calls.append("old")
        started.set()
        assert finish.wait(timeout=5)
        return ["old"]

    def fresh_builder():
        calls.append("fresh")
        fresh_started.set()
        assert finish_fresh.wait(timeout=5)
        return ["fresh"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        old = pool.submit(_read, cache_api, layer, old_builder)
        try:
            assert started.wait(timeout=2)
            cache_api.invalidate(None if reset_all else 17)
            fresh = pool.submit(_read, cache_api, layer, fresh_builder)
            assert fresh_started.wait(timeout=2)
            if old_finishes_first:
                finish.set()
                assert old.result(timeout=2) == ["old"]
            finish_fresh.set()
            assert fresh.result(timeout=2) == ["fresh"]
            finish.set()
            assert old.result(timeout=2) == ["old"]
            assert _read(cache_api, layer, fresh_builder) == ["fresh"]
            if layer == "combined":
                assert _read(cache_api, "payload", fresh_builder) == ["fresh"]
            assert calls == ["old", "fresh"]
        finally:
            finish.set()
            finish_fresh.set()


def test_account_payload_does_not_retry_internal_type_error_without_details():
    calls = []

    def list_accounts(include_details=True):
        calls.append(include_details)
        if not include_details:
            raise TypeError("internal account decoding failure")
        return ["unexpected-detailed-fallback"]

    invalidate_accounts_listing_cache()
    try:
        with pytest.raises(TypeError, match="internal account decoding failure"):
            get_cached_rgw_accounts_payload(17, lambda: list_accounts(include_details=False))
        assert calls == [False]
        assert get_cached_rgw_accounts_payload(17, lambda: ["recovered"]) == ["recovered"]
    finally:
        invalidate_accounts_listing_cache()


@pytest.mark.parametrize("layer", ["payload", "listing", "combined"])
def test_cancelled_request_does_not_cancel_another_load(cache_api, layer):
    started = [Event(), Event()]
    finish = [Event(), Event()]

    def cancelled_builder():
        started[0].set()
        assert finish[0].wait(timeout=5)
        raise ListingCancelled()

    def successful_builder():
        started[1].set()
        assert finish[1].wait(timeout=5)
        return ["independent"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        cancelled = pool.submit(_read, cache_api, layer, cancelled_builder)
        try:
            assert started[0].wait(timeout=2)
            successful = pool.submit(_read, cache_api, layer, successful_builder)
            assert started[1].wait(timeout=2)
            finish[0].set()
            with pytest.raises(ListingCancelled):
                cancelled.result(timeout=2)
            finish[1].set()
            assert successful.result(timeout=2) == ["independent"]
            assert _read(cache_api, layer, lambda: ["unexpected-reload"]) == ["independent"]
        finally:
            for event in finish:
                event.set()


@pytest.mark.parametrize("layer", ["payload", "listing", "combined"])
def test_other_endpoint_invalidation_does_not_discard_pending_load(cache_api, layer):
    started = Event()
    finish = Event()

    def builder():
        started.set()
        assert finish.wait(timeout=5)
        return ["kept"]

    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(_read, cache_api, layer, builder)
        try:
            assert started.wait(timeout=2)
            assert _read(cache_api, layer, lambda: ["other"], 18) == ["other"]
            cache_api.invalidate(18)
            finish.set()
            assert pending.result(timeout=2) == ["kept"]
            assert _read(cache_api, layer, lambda: ["unexpected-reload"]) == ["kept"]
            assert _read(cache_api, layer, lambda: ["refreshed"], 18) == ["refreshed"]
        finally:
            finish.set()


def test_rgw_errors_keep_http_translation_and_are_not_cached(cache_api):
    def failing_builder():
        raise RGWAdminError("upstream listing failed")

    with pytest.raises(HTTPException) as error:
        _read(cache_api, "payload", failing_builder)
    assert error.value.status_code == 502
    assert error.value.detail == "upstream listing failed"
    assert _read(cache_api, "payload", lambda: ["recovered"]) == ["recovered"]


def test_cache_expiration_lru_and_pending_state_lifecycle(monkeypatch):
    now = 100.0
    monkeypatch.setattr(ceph_admin_identity_listing_cache, "monotonic", lambda: now)
    cache = EndpointListingCache(ttl_seconds=10, payload_max_entries=2, listing_max_entries=1)
    assert cache.get_payload(1, lambda: []) == []
    assert cache.get_payload(2, lambda: [2]) == [2]
    assert cache.get_payload(1, lambda: ["unexpected-reload"]) == []
    assert cache.get_payload(3, lambda: [3]) == [3]
    assert cache.get_payload(1, lambda: ["unexpected-reload"]) == []
    assert cache.get_payload(2, lambda: ["evicted"]) == ["evicted"]
    key = EndpointListCacheKey(1, None, "name", "asc")
    assert cache.get_listing(key, lambda: ["listing"]) == ["listing"]
    now = 109.0
    assert cache.get_listing(key, lambda: ["unexpected-reload"]) == ["listing"]
    now = 110.0
    assert cache.get_listing(key, lambda: ["expired"]) == ["expired"]
    assert cache.get_payload(2, lambda: ["expired"]) == ["expired"]
    for endpoint_id in range(4, 10):
        assert cache.get_payload(endpoint_id, lambda: []) == []
        assert cache.get_listing(EndpointListCacheKey(endpoint_id, None, "name", "asc"), lambda: []) == []
        assert cache._pending == {}
    assert len(cache._payloads) == 2
    assert len(cache._listings) == 1


def test_account_and_user_caches_remain_separate():
    invalidate_accounts_listing_cache()
    invalidate_users_listing_cache()
    try:
        assert get_cached_rgw_accounts_payload(17, lambda: ["account"]) == ["account"]
        assert get_cached_rgw_users_payload(17, lambda: ["user"]) == ["user"]
        invalidate_accounts_listing_cache(17)
        assert get_cached_rgw_users_payload(17, lambda: ["unexpected"]) == ["user"]
    finally:
        invalidate_accounts_listing_cache()
        invalidate_users_listing_cache()
