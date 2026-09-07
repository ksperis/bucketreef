# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest

from app.models.bucket_listing import BucketListingSummary
from app.services import ceph_admin_bucket_listing_cache as cache


@pytest.fixture(autouse=True)
def reset_caches():
    cache.reset_ceph_admin_bucket_listing_caches_for_tests()
    yield
    cache.reset_ceph_admin_bucket_listing_caches_for_tests()


def _read_raw(builder, *, endpoint_id=17, with_stats=False):
    ctx = SimpleNamespace(
        endpoint=SimpleNamespace(id=endpoint_id),
        rgw_admin=SimpleNamespace(get_all_buckets=lambda with_stats: builder()),
    )
    return cache.get_cached_rgw_bucket_entries(ctx, with_stats=with_stats)[0]["name"]


def _read_snapshot(builder, *, endpoint_id=17):
    key = cache.CephAdminBucketListCacheKey(
        endpoint_id=endpoint_id,
        advanced_filter=None,
        sort_by="name",
        sort_dir="asc",
        with_stats=False,
        with_owner_metadata=False,
        with_owner_usage=False,
    )
    return cache.get_cached_bucket_listing(
        key,
        lambda: cache.CephAdminBucketListingSnapshot(
            items=[BucketListingSummary(**item) for item in builder()],
        ),
    ).items[0].name


def _read_listing(builder, *, endpoint_id=17):
    return _read_snapshot(
        lambda: [{"name": _read_raw(builder, endpoint_id=endpoint_id)}],
        endpoint_id=endpoint_id,
    )


@pytest.fixture
def observed_wait(monkeypatch):
    waiting = Event()

    class ObservedEvent(Event):
        def wait(self, timeout=None):
            waiting.set()
            return super().wait(timeout=timeout)

    class ObservedFuture(Future):
        def result(self, timeout=None):
            waiting.set()
            return super().result(timeout=timeout)

    monkeypatch.setattr(cache, "Event", ObservedEvent)
    monkeypatch.setattr(cache, "Future", ObservedFuture)
    return waiting


@pytest.mark.parametrize("read", [_read_raw, _read_snapshot, _read_listing])
@pytest.mark.parametrize("reset_all", [False, True])
@pytest.mark.parametrize("old_finishes_first", [False, True])
@pytest.mark.parametrize("old_fails", [False, True])
def test_invalidation_detaches_pending_load(read, reset_all, old_finishes_first, old_fails):
    started = [Event(), Event()]
    finish = [Event(), Event()]
    calls = [0, 0]
    provider_error = RuntimeError("old provider failure")

    def build(generation):
        calls[generation] += 1
        started[generation].set()
        assert finish[generation].wait(timeout=5)
        if generation == 0 and old_fails:
            raise provider_error
        return [{"name": f"generation-{generation}"}]

    def finish_old(future):
        finish[0].set()
        if old_fails:
            with pytest.raises(RuntimeError) as error:
                future.result(timeout=2)
            assert error.value is provider_error
        else:
            assert future.result(timeout=2) == "generation-0"

    with ThreadPoolExecutor(max_workers=2) as pool:
        old = pool.submit(read, lambda: build(0))
        try:
            assert started[0].wait(timeout=2)
            if reset_all:
                cache.reset_ceph_admin_bucket_listing_caches_for_tests()
            else:
                cache.invalidate_bucket_listing_cache(17)
            fresh = pool.submit(read, lambda: build(1))
            assert started[1].wait(timeout=2)
            if old_finishes_first:
                finish_old(old)
            finish[1].set()
            assert fresh.result(timeout=2) == "generation-1"
            if not old_finishes_first:
                finish_old(old)
            assert read(lambda: build(1)) == "generation-1"
            if read is _read_listing:
                assert _read_raw(lambda: build(1)) == "generation-1"
            assert calls == [1, 1]
        finally:
            for event in finish:
                event.set()


@pytest.mark.parametrize("first_stats", [False, True])
@pytest.mark.parametrize("second_stats", [False, True])
@pytest.mark.parametrize("first_fails", [False, True])
def test_payload_waiter_rechecks_stats_and_retries_after_error(
    observed_wait, first_stats, second_stats, first_fails,
):
    started = Event()
    finish = Event()
    calls = []
    provider_error = RuntimeError("first provider failure")

    def build_first():
        calls.append(0)
        started.set()
        assert finish.wait(timeout=5)
        if first_fails:
            raise provider_error
        return [{"name": "first"}]

    def build_second():
        calls.append(1)
        return [{"name": "second"}]

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(_read_raw, build_first, with_stats=first_stats)
        try:
            assert started.wait(timeout=2)
            second = pool.submit(_read_raw, build_second, with_stats=second_stats)
            assert observed_wait.wait(timeout=2)
            assert calls == [0]
            finish.set()
            if first_fails:
                with pytest.raises(RuntimeError) as error:
                    first.result(timeout=2)
                assert error.value is provider_error
            else:
                assert first.result(timeout=2) == "first"
            needs_second = first_fails or (second_stats and not first_stats)
            assert second.result(timeout=2) == ("second" if needs_second else "first")
            assert calls == ([0, 1] if needs_second else [0])
            assert cache._RGW_BUCKET_PAYLOAD_INFLIGHT == {}
        finally:
            finish.set()


@pytest.mark.parametrize("read", [_read_raw, _read_snapshot, _read_listing])
@pytest.mark.parametrize("old_fails", [False, True])
def test_old_completion_preserves_new_load_and_its_waiters(observed_wait, read, old_fails):
    started = [Event(), Event()]
    finish = [Event(), Event()]
    calls = [0, 0]

    def build(generation):
        calls[generation] += 1
        started[generation].set()
        assert finish[generation].wait(timeout=5)
        if generation == 0 and old_fails:
            raise RuntimeError("old provider failure")
        return [{"name": f"generation-{generation}"}]

    with ThreadPoolExecutor(max_workers=3) as pool:
        old = pool.submit(read, lambda: build(0))
        try:
            assert started[0].wait(timeout=2)
            cache.invalidate_bucket_listing_cache(17)
            fresh = pool.submit(read, lambda: build(1))
            assert started[1].wait(timeout=2)
            finish[0].set()
            if old_fails:
                with pytest.raises(RuntimeError, match="old provider failure"):
                    old.result(timeout=2)
            else:
                assert old.result(timeout=2) == "generation-0"
            waiter = pool.submit(read, lambda: build(1))
            assert observed_wait.wait(timeout=2)
            finish[1].set()
            assert fresh.result(timeout=2) == "generation-1"
            assert waiter.result(timeout=2) == "generation-1"
            assert calls == [1, 1]
            assert cache._RGW_BUCKET_PAYLOAD_INFLIGHT == {}
            assert cache._BUCKET_LIST_INFLIGHT == {}
        finally:
            for event in finish:
                event.set()


@pytest.mark.parametrize("read", [_read_raw, _read_snapshot, _read_listing])
def test_other_endpoint_invalidation_preserves_pending_load(observed_wait, read):
    started = Event()
    finish = Event()
    calls = 0

    def build():
        nonlocal calls
        calls += 1
        started.set()
        assert finish.wait(timeout=5)
        return [{"name": "kept"}]

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(read, build)
        try:
            assert started.wait(timeout=2)
            assert read(lambda: [{"name": "other"}], endpoint_id=18) == "other"
            cache.invalidate_bucket_listing_cache(18)
            second = pool.submit(read, build)
            assert observed_wait.wait(timeout=2)
            finish.set()
            assert first.result(timeout=2) == "kept"
            assert second.result(timeout=2) == "kept"
            assert calls == 1
            assert read(lambda: [{"name": "refreshed"}], endpoint_id=18) == "refreshed"
        finally:
            finish.set()


def test_completed_endpoints_do_not_retain_coordination_state():
    for endpoint_id in range(cache.BUCKET_LIST_CACHE_MAX_ENTRIES + 3):
        assert _read_listing(lambda: [{"name": "bucket"}], endpoint_id=endpoint_id) == "bucket"
        assert cache._RGW_BUCKET_PAYLOAD_INFLIGHT == {}
        assert cache._BUCKET_LIST_INFLIGHT == {}
    assert len(cache._BUCKET_LIST_CACHE) == cache.BUCKET_LIST_CACHE_MAX_ENTRIES
    assert len(cache._RGW_BUCKET_PAYLOAD_CACHE) == cache.RGW_BUCKET_PAYLOAD_CACHE_MAX_ENTRIES


@pytest.mark.parametrize("read", [_read_raw, _read_snapshot, _read_listing])
@pytest.mark.parametrize("old_fails", [False, True])
def test_invalidation_does_not_abandon_existing_waiters(observed_wait, read, old_fails):
    started = Event()
    finish = Event()
    provider_error = RuntimeError("old provider failure")

    def build_old():
        started.set()
        assert finish.wait(timeout=5)
        if old_fails:
            raise provider_error
        return [{"name": "old"}]

    def assert_old_result(future):
        if old_fails:
            with pytest.raises(RuntimeError) as error:
                future.result(timeout=2)
            assert error.value is provider_error
        else:
            assert future.result(timeout=2) == "old"

    with ThreadPoolExecutor(max_workers=3) as pool:
        old = pool.submit(read, build_old)
        try:
            assert started.wait(timeout=2)
            waiter = pool.submit(read, build_old)
            assert observed_wait.wait(timeout=2)
            cache.invalidate_bucket_listing_cache(17)
            fresh = pool.submit(read, lambda: [{"name": "fresh"}])
            assert fresh.result(timeout=2) == "fresh"
            finish.set()
            assert_old_result(old)
            if read is _read_raw:
                # Payload waiters recheck the cache; snapshot waiters share the
                # original result or error through their already-held future.
                assert waiter.result(timeout=2) == "fresh"
            else:
                assert_old_result(waiter)
        finally:
            finish.set()
