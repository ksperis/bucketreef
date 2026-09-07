# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import replace

import pytest

from app.db import S3Account, User, UserRole
from app.main import app
from app.models.bucket import Bucket
from app.models.execution_context import ExecutionContextCapabilities
from app.routers import dependencies
from app.routers.manager import buckets as manager_buckets_router
from app.routers.storage_ops import buckets as storage_ops_buckets_router
from app.services import bucket_listing_cache
from app.services.bucket_listing_cache import (
    get_cached_bucket_listing_for_account,
    invalidate_bucket_listing_cache,
    invalidate_bucket_listing_cache_for_account,
)
from app.services.s3_execution_context import S3ExecutionContext
from tests.execution_context_factory import make_execution_context


class _FakeAuditService:
    def record_action(self, **kwargs):  # noqa: ANN003
        return None


class _FakeBucketsService:
    def __init__(self) -> None:
        self.list_calls = 0

    @property
    def configuration(self):
        return self

    def list_buckets(self, account, include=None, with_stats=True):  # noqa: ANN001, ARG002
        self.list_calls += 1
        return [Bucket(name=f"demo-{account.id}", used_bytes=123)]

    def set_versioning(self, bucket_name: str, account, enabled: bool) -> None:  # noqa: ANN001, ARG002
        return None


def _build_account() -> S3Account:
    account = S3Account(
        name="cache-account",
        rgw_account_id="RGW00000000000000999",
        rgw_access_key="AK-CACHE",
        rgw_secret_key="SK-CACHE",
    )
    account.id = 1
    return account


def _admin_user() -> User:
    return User(
        id=101,
        email="ops-admin@example.com",
        full_name="Ops Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_ADMIN.value,
    )


def _manager_user() -> User:
    return User(
        id=102,
        email="manager@example.com",
        full_name="Manager",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )


def test_manager_bucket_listing_uses_shared_cache(client):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()

    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_buckets_router.get_current_account_admin] = _manager_user
    try:
        first = client.get("/api/manager/buckets")
        second = client.get("/api/manager/buckets")
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert service.list_calls == 1
    finally:
        app.dependency_overrides.pop(manager_buckets_router.get_account_context, None)
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_current_account_admin, None)
        invalidate_bucket_listing_cache()


def test_manager_mutation_invalidates_shared_cache_for_storage_ops(client, monkeypatch):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request=None, account_ref=None, actor=None, db=None):  # noqa: ARG001
        return account

    monkeypatch.setattr(storage_ops_buckets_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_buckets_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[manager_buckets_router.get_account_context] = lambda: account
    app.dependency_overrides[manager_buckets_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_buckets_router.get_bucket_configuration_service] = lambda: service
    app.dependency_overrides[storage_ops_buckets_router.get_buckets_service] = lambda: service
    app.dependency_overrides[manager_buckets_router.get_current_account_admin] = _manager_user
    app.dependency_overrides[manager_buckets_router.get_audit_service] = lambda: _FakeAuditService()
    try:
        manager_first = client.get("/api/manager/buckets")
        assert manager_first.status_code == 200, manager_first.text
        storage_ops_cached = client.get("/api/storage-ops/buckets")
        assert storage_ops_cached.status_code == 200, storage_ops_cached.text
        assert service.list_calls == 1

        mutate = client.put("/api/manager/buckets/demo-1/versioning", json={"enabled": True})
        assert mutate.status_code == 200, mutate.text

        storage_ops_after_mutation = client.get("/api/storage-ops/buckets")
        assert storage_ops_after_mutation.status_code == 200, storage_ops_after_mutation.text
        assert service.list_calls == 2
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(manager_buckets_router.get_account_context, None)
        app.dependency_overrides.pop(manager_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_bucket_configuration_service, None)
        app.dependency_overrides.pop(storage_ops_buckets_router.get_buckets_service, None)
        app.dependency_overrides.pop(manager_buckets_router.get_current_account_admin, None)
        app.dependency_overrides.pop(manager_buckets_router.get_audit_service, None)
        invalidate_bucket_listing_cache()


def test_storage_ops_bucket_listing_cache_refresh_endpoint_invalidates_shared_cache(client, monkeypatch):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()

    def fake_list_execution_contexts(*, workspace, user, db):  # noqa: ARG001
        assert workspace == "manager"
        return [
            make_execution_context(
                kind="account",
                id="1",
                display_name="Account One",
                capabilities=ExecutionContextCapabilities(can_manage_iam=True, sts_capable=False, admin_api_capable=True),
            )
        ]

    def fake_get_account_context(*, request=None, account_ref=None, actor=None, db=None):  # noqa: ARG001
        return account

    monkeypatch.setattr(storage_ops_buckets_router, "list_execution_contexts", fake_list_execution_contexts)
    monkeypatch.setattr(storage_ops_buckets_router, "get_account_context", fake_get_account_context)

    app.dependency_overrides[dependencies.require_storage_ops_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_storage_ops_admin] = _admin_user
    app.dependency_overrides[storage_ops_buckets_router.get_buckets_service] = lambda: service
    try:
        first = client.get("/api/storage-ops/buckets")
        second = client.get("/api/storage-ops/buckets")
        assert first.status_code == 200, first.text
        assert second.status_code == 200, second.text
        assert service.list_calls == 1

        refresh = client.post("/api/storage-ops/buckets/cache/refresh")
        assert refresh.status_code == 200, refresh.text
        assert refresh.json()["contexts"] == 1

        after_refresh = client.get("/api/storage-ops/buckets")
        assert after_refresh.status_code == 200, after_refresh.text
        assert service.list_calls == 2
    finally:
        app.dependency_overrides.pop(dependencies.require_storage_ops_enabled, None)
        app.dependency_overrides.pop(dependencies.get_current_storage_ops_admin, None)
        app.dependency_overrides.pop(storage_ops_buckets_router.get_buckets_service, None)
        invalidate_bucket_listing_cache()


def test_shared_bucket_listing_cache_coalesces_parallel_misses():
    invalidate_bucket_listing_cache()
    account = _build_account()
    builder_calls = 0
    builder_lock = threading.Lock()
    unblock = threading.Event()
    builder_started = threading.Event()
    results: list[list[Bucket]] = []
    errors: list[Exception] = []

    def builder():
        nonlocal builder_calls
        with builder_lock:
            builder_calls += 1
        builder_started.set()
        assert unblock.wait(timeout=1.0)
        return [Bucket(name="parallel-demo", used_bytes=1)]

    def worker() -> None:
        try:
            listed = get_cached_bucket_listing_for_account(
                account=account,
                include=set(),
                with_stats=True,
                builder=builder,
            )
            results.append(listed)
        except Exception as exc:  # pragma: no cover - defensive capture for thread boundary
            errors.append(exc)

    first = threading.Thread(target=worker)
    second = threading.Thread(target=worker)
    first.start()
    second.start()
    assert builder_started.wait(timeout=1.0)
    unblock.set()
    first.join(timeout=2.0)
    second.join(timeout=2.0)

    assert not errors
    assert builder_calls == 1
    assert len(results) == 2
    assert all(len(items) == 1 and items[0].name == "parallel-demo" for items in results)


def test_shared_bucket_listing_cache_expires_after_ttl(monkeypatch):
    invalidate_bucket_listing_cache()
    account = _build_account()
    service = _FakeBucketsService()
    now = 1000.0

    monkeypatch.setattr("app.services.bucket_listing_cache.monotonic", lambda: now)

    first = get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=True,
        builder=lambda: service.list_buckets(account, include=None, with_stats=True),
    )
    assert len(first) == 1
    assert service.list_calls == 1

    now = 2799.0
    second = get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=True,
        builder=lambda: service.list_buckets(account, include=None, with_stats=True),
    )
    assert len(second) == 1
    assert service.list_calls == 1

    now = 2801.0
    third = get_cached_bucket_listing_for_account(
        account=account,
        include=set(),
        with_stats=True,
        builder=lambda: service.list_buckets(account, include=None, with_stats=True),
    )
    assert len(third) == 1
    assert service.list_calls == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"secret_key": "rotated-secret"},
        {"session_token_value": "renewed-session"},
        {"session_region": "us-west-2"},
        {"session_force_path_style": False},
        {"session_verify_tls": False},
        {"context_kind": "portal_account"},
    ],
)
def test_shared_cache_partitions_execution_configuration_and_invalidates_scope(changes):
    account = _build_account()
    access_key, secret_key = account.effective_rgw_credentials()
    context = S3ExecutionContext.from_account(
        account, access_key=access_key, secret_key=secret_key,
    )
    context.session_token_value = "original-session"
    context.session_region = "us-east-1"
    context.session_force_path_style = True
    context.session_verify_tls = True
    other = replace(context, **changes)
    calls = 0

    def builder():
        nonlocal calls
        calls += 1
        return [Bucket(name=f"result-{calls}")]

    def read(target):
        return get_cached_bucket_listing_for_account(
            account=target, include=set(), with_stats=False, builder=builder,
        )[0].name

    assert read(context) == "result-1"
    assert read(context) == "result-1"
    assert read(other) == "result-2"
    assert read(other) == "result-2"
    invalidate_bucket_listing_cache_for_account(account)
    assert read(context) == "result-3"
    assert read(other) == "result-4"


@pytest.mark.parametrize(
    ("kind", "context_id", "source_ids"),
    [
        ("account", "1", {"id": 1}),
        ("portal_account", "1", {"id": 1}),
        ("connection", "conn-1", {"s3_connection_id": 1}),
        ("s3_user", "s3u-1", {"s3_user_id": 1}),
        ("ceph_admin", "ceph-admin-1", {"ceph_admin_endpoint_id": 1}),
        ("session", "1", {"id": 1}),
        ("session", "session:external", {"rgw_account_id": "external"}),
    ],
)
def test_shared_cache_scope_uses_explicit_context_id(kind, context_id, source_ids):
    context = S3ExecutionContext(
        context_kind=kind,
        context_id=context_id,
        name="context",
        access_key="AK",
        secret_key="SK",
        **source_ids,
    )
    without_source_metadata = replace(context, **dict.fromkeys(source_ids))
    other_scope = replace(context, context_id=f"{context_id}-other")
    calls = 0

    def builder():
        nonlocal calls
        calls += 1
        return [Bucket(name=f"result-{calls}")]

    def read(target):
        return get_cached_bucket_listing_for_account(
            account=target, include=set(), with_stats=False, builder=builder,
        )[0].name

    assert read(context) == "result-1"
    assert read(without_source_metadata) == "result-1"
    assert read(other_scope) == "result-2"
    invalidate_bucket_listing_cache_for_account(without_source_metadata)
    assert read(context) == "result-3"
    assert read(other_scope) == "result-2"


@pytest.mark.parametrize("invalidate_all", [False, True])
@pytest.mark.parametrize("old_finishes_first", [False, True])
@pytest.mark.parametrize("old_fails", [False, True])
def test_invalidation_detaches_pending_listing(
    invalidate_all, old_finishes_first, old_fails,
):
    account = _build_account()
    old_started = threading.Event()
    new_started = threading.Event()
    finish_old = threading.Event()
    finish_new = threading.Event()
    new_calls = 0
    provider_error = RuntimeError("old provider failure")

    def old_builder():
        old_started.set()
        assert finish_old.wait(timeout=5)
        if old_fails:
            raise provider_error
        return [Bucket(name="old")]

    def new_builder():
        nonlocal new_calls
        new_calls += 1
        new_started.set()
        assert finish_new.wait(timeout=5)
        return [Bucket(name="fresh")]

    def read(builder):
        return get_cached_bucket_listing_for_account(
            account=account, include=set(), with_stats=True, builder=builder,
        )[0].name

    def finish_old_read(future):
        finish_old.set()
        if old_fails:
            with pytest.raises(RuntimeError) as error:
                future.result(timeout=2)
            assert error.value is provider_error
        else:
            assert future.result(timeout=2) == "old"

    with ThreadPoolExecutor(max_workers=2) as pool:
        old = pool.submit(read, old_builder)
        try:
            assert old_started.wait(timeout=2)
            if invalidate_all:
                invalidate_bucket_listing_cache()
            else:
                invalidate_bucket_listing_cache_for_account(account)
            fresh = pool.submit(read, new_builder)
            assert new_started.wait(timeout=2)
            if old_finishes_first:
                finish_old_read(old)
            finish_new.set()
            assert fresh.result(timeout=2) == "fresh"
            if not old_finishes_first:
                finish_old_read(old)
            assert read(new_builder) == "fresh"
            assert new_calls == 1
        finally:
            finish_old.set()
            finish_new.set()


@pytest.mark.parametrize("old_fails", [False, True])
def test_invalidation_preserves_existing_waiters_and_new_load_ownership(monkeypatch, old_fails):
    account = _build_account()
    started = [threading.Event(), threading.Event()]
    waiting = [threading.Event(), threading.Event()]
    finish = [threading.Event(), threading.Event()]
    loads = []
    provider_error = RuntimeError("old provider failure")

    class ObservedFuture(Future):
        def __init__(self):
            super().__init__()
            self.waiting = waiting[len(loads)]
            loads.append(self)

        def result(self, timeout=None):
            self.waiting.set()
            return super().result(timeout=timeout)

    monkeypatch.setattr(bucket_listing_cache, "Future", ObservedFuture)

    def read(generation):
        def builder():
            started[generation].set()
            assert finish[generation].wait(timeout=5)
            if generation == 0 and old_fails:
                raise provider_error
            return [Bucket(name=f"generation-{generation}")]

        return get_cached_bucket_listing_for_account(
            account=account, include=set(), with_stats=False, builder=builder,
        )[0].name

    with ThreadPoolExecutor(max_workers=4) as pool:
        old = pool.submit(read, 0)
        try:
            assert started[0].wait(timeout=2)
            old_waiter = pool.submit(read, 0)
            assert waiting[0].wait(timeout=2)
            invalidate_bucket_listing_cache_for_account(account)
            fresh = pool.submit(read, 1)
            assert started[1].wait(timeout=2)
            finish[0].set()
            for request in (old, old_waiter):
                if old_fails:
                    with pytest.raises(RuntimeError) as error:
                        request.result(timeout=2)
                    assert error.value is provider_error
                else:
                    assert request.result(timeout=2) == "generation-0"
            fresh_waiter = pool.submit(read, 1)
            assert waiting[1].wait(timeout=2)
            finish[1].set()
            assert fresh.result(timeout=2) == "generation-1"
            assert fresh_waiter.result(timeout=2) == "generation-1"
            assert read(1) == "generation-1"
            assert len(loads) == 2
        finally:
            for event in finish:
                event.set()


def test_scoped_invalidation_preserves_unrelated_pending_load(monkeypatch):
    account = _build_account()
    other = _build_account()
    other.id = 2
    started = threading.Event()
    waiting = threading.Event()
    finish = threading.Event()
    calls = 0

    class ObservedFuture(Future):
        def result(self, timeout=None):
            waiting.set()
            return super().result(timeout=timeout)

    monkeypatch.setattr(bucket_listing_cache, "Future", ObservedFuture)

    def builder():
        nonlocal calls
        calls += 1
        started.set()
        assert finish.wait(timeout=5)
        return [Bucket(name="unaffected")]

    def read():
        return get_cached_bucket_listing_for_account(
            account=account, include=set(), with_stats=False, builder=builder,
        )[0].name

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(read)
        try:
            assert started.wait(timeout=2)
            invalidate_bucket_listing_cache_for_account(other)
            second = pool.submit(read)
            assert waiting.wait(timeout=2)
            finish.set()
            assert first.result(timeout=2) == "unaffected"
            assert second.result(timeout=2) == "unaffected"
            assert read() == "unaffected"
            assert calls == 1
        finally:
            finish.set()
