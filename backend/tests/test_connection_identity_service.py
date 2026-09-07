# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Event
from types import SimpleNamespace

import pytest

from app.db import S3Connection, StorageEndpoint
from app.services import connection_identity_service as identity_service
from app.services.rgw_admin import RGWAdminError
from app.services.connection_identity_service import (
    ConnectionIdentityService,
    reset_connection_identity_cache_for_tests,
)


@pytest.fixture(autouse=True)
def clean_identity_cache():
    reset_connection_identity_cache_for_tests()
    yield
    reset_connection_identity_cache_for_tests()


def _ceph_endpoint(
    *,
    name: str = "ceph-endpoint",
    metrics_enabled: bool = True,
    usage_enabled: bool = True,
) -> StorageEndpoint:
    return StorageEndpoint(
        id=1,
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        region="eu-west-1",
        supervision_access_key="SUP-AK",
        supervision_secret_key="SUP-SK",
        features_config=(
            "features:\n"
            "  admin:\n"
            "    enabled: true\n"
            f"  metrics:\n    enabled: {'true' if metrics_enabled else 'false'}\n"
            f"  usage:\n    enabled: {'true' if usage_enabled else 'false'}\n"
        ),
    )


def _connection(
    endpoint: StorageEndpoint,
    *,
    owner_type: str | None = None,
    owner_identifier: str | None = None,
) -> S3Connection:
    return S3Connection(
        id=42,
        created_by_user_id=1,
        name="conn",
        storage_endpoint_id=endpoint.id,
        storage_endpoint=endpoint,
        access_key_id="AKIA-CONN-TEST",
        secret_access_key="SECRET-CONN-TEST",
        credential_owner_type=owner_type,
        credential_owner_identifier=owner_identifier,
        capabilities_json=json.dumps({"can_manage_iam": False}),
    )


@pytest.mark.parametrize("scope", ["identity", "metrics"])
@pytest.mark.parametrize("target,field,value", [
    ("connection", "updated_at", datetime(2026, 9, 7, 12, 0, 0, 200, tzinfo=UTC)),
    ("endpoint", "updated_at", datetime(2026, 9, 7, 12, 0, 0, 200, tzinfo=UTC)),
    ("endpoint", "endpoint_url", "https://new-rgw.example.test"),
    ("endpoint", "region", "new-region"),
    ("endpoint", "verify_tls", False),
    ("endpoint", "supervision_access_key", "NEW-SUP-AK"),
    ("endpoint", "supervision_secret_key", "NEW-SUP-SK"),
    ("endpoint", "admin_access_key", "NEW-ADMIN-AK"),
    ("endpoint", "admin_secret_key", "NEW-ADMIN-SK"),
])
def test_identity_cache_rechecks_configuration_changes(monkeypatch, scope, target, field, value):
    endpoint = _ceph_endpoint()
    endpoint.verify_tls = True
    endpoint.updated_at = datetime(2026, 9, 7, 12, 0, 0, 100, tzinfo=UTC)
    connection = _connection(endpoint)
    connection.updated_at = endpoint.updated_at
    calls = []

    def client(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(get_user_by_access_key=lambda *args, **kwargs: {"uid": f"user-{len(calls)}"})

    monkeypatch.setattr(identity_service, "get_rgw_admin_client", client)
    service = ConnectionIdentityService()
    resolve = service.resolve_metrics_identity if scope == "metrics" else service.resolve_rgw_identity
    assert resolve(connection).iam_identity == "user-1"
    setattr(connection if target == "connection" else endpoint, field, value)

    assert resolve(connection).iam_identity == "user-2"
    assert len(calls) == 2


def test_identity_cache_has_a_size_limit(monkeypatch):
    monkeypatch.setattr(identity_service, "_CACHE_MAX_ENTRIES", 2)
    service = ConnectionIdentityService()
    for connection_id in range(3):
        connection = _connection(_ceph_endpoint(), owner_type="s3_user", owner_identifier=f"user-{connection_id}")
        connection.id = connection_id
        service.resolve_rgw_identity(connection)

    assert len(identity_service._CACHE) == 2


@pytest.mark.parametrize("initially_missing", [False, True])
def test_identity_cache_expires_success_and_negative_results(monkeypatch, initially_missing):
    clock = [100.0]
    monkeypatch.setattr(identity_service, "monotonic", lambda: clock[0])
    calls = []

    def lookup(*args, **kwargs):
        calls.append(None)
        return None if initially_missing and len(calls) == 1 else {"uid": f"user-{len(calls)}"}

    monkeypatch.setattr(identity_service, "get_rgw_admin_client", lambda **kwargs: SimpleNamespace(get_user_by_access_key=lookup))
    service = ConnectionIdentityService()
    connection = _connection(_ceph_endpoint())
    first = service.resolve_rgw_identity(connection)
    assert first.eligible is not initially_missing
    clock[0] += identity_service._CACHE_TTL_SECONDS - 0.1
    assert service.resolve_rgw_identity(connection) is first
    clock[0] = 100.0 + identity_service._CACHE_TTL_SECONDS
    second = service.resolve_rgw_identity(connection)
    assert second.iam_identity == "user-2"
    assert len(calls) == 2
    assert len(identity_service._CACHE) == 1


def test_identity_cache_prunes_expired_entries_and_evicts_least_recently_used(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(identity_service, "monotonic", lambda: clock[0])
    monkeypatch.setattr(identity_service, "_CACHE_MAX_ENTRIES", 2)
    service = ConnectionIdentityService()
    connections = [_connection(_ceph_endpoint(), owner_type="s3_user", owner_identifier=f"user-{index}") for index in range(4)]
    first, second, third, fourth = connections
    first_result = service.resolve_rgw_identity(first)
    second_result = service.resolve_rgw_identity(second)
    assert service.resolve_rgw_identity(first) is first_result
    service.resolve_rgw_identity(third)
    assert service._cache_key(second, scope="identity") not in identity_service._CACHE
    assert service.resolve_rgw_identity(first) is first_result
    assert service.resolve_rgw_identity(second) is not second_result

    clock[0] += identity_service._CACHE_TTL_SECONDS
    service.resolve_rgw_identity(fourth)
    assert list(identity_service._CACHE) == [service._cache_key(fourth, scope="identity")]


def test_identity_and_metrics_scopes_do_not_share_feature_eligibility():
    endpoint = _ceph_endpoint(metrics_enabled=False, usage_enabled=False)
    connection = _connection(endpoint, owner_type="s3_user", owner_identifier="owner")
    service = ConnectionIdentityService()

    assert service.resolve_rgw_identity(connection).eligible is True
    assert service.resolve_metrics_identity(connection).eligible is False
    assert len(identity_service._CACHE) == 2
    assert {key.scope for key in identity_service._CACHE} == {"identity", "metrics"}


def test_identity_cache_keys_do_not_retain_credentials():
    endpoint = _ceph_endpoint()
    endpoint.admin_access_key = "PRIVATE-ADMIN-AK"
    endpoint.admin_secret_key = "PRIVATE-ADMIN-SK"
    connection = _connection(endpoint, owner_type="s3_user", owner_identifier="owner")
    ConnectionIdentityService().resolve_metrics_identity(connection)
    keys = repr(list(identity_service._CACHE))
    for secret in (
        connection.access_key_id, connection.secret_access_key,
        endpoint.supervision_access_key, endpoint.supervision_secret_key,
        endpoint.admin_access_key, endpoint.admin_secret_key,
    ):
        assert secret not in keys


@pytest.mark.parametrize("scope", ["identity", "metrics"])
@pytest.mark.parametrize("failure_type", [None, RGWAdminError, RuntimeError, BaseException])
def test_identical_concurrent_lookups_share_completion_and_release_state(monkeypatch, scope, failure_type):
    started, waiting, release = Event(), Event(), Event()
    calls = []

    class ObservedFuture(Future):
        def result(self, timeout=None):
            waiting.set()
            return super().result(timeout=timeout)

    def lookup(*args, **kwargs):
        calls.append(None)
        started.set()
        assert release.wait(5)
        if failure_type is not None:
            raise failure_type("lookup interrupted")
        return {"uid": "shared-user"}

    monkeypatch.setattr(identity_service, "Future", ObservedFuture)
    monkeypatch.setattr(identity_service, "get_rgw_admin_client", lambda **kwargs: SimpleNamespace(get_user_by_access_key=lookup))
    connection = _connection(_ceph_endpoint())
    service = ConnectionIdentityService()
    resolve = service.resolve_metrics_identity if scope == "metrics" else service.resolve_rgw_identity
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            owner = pool.submit(resolve, connection)
            assert started.wait(5)
            waiter = pool.submit(resolve, connection)
            assert waiting.wait(5)
            release.set()
            if failure_type in (None, RGWAdminError):
                assert owner.result(timeout=5) is waiter.result(timeout=5)
                if failure_type is None:
                    assert owner.result().iam_identity == "shared-user"
                else:
                    assert owner.result().eligible is False
                    assert "lookup interrupted" in owner.result().reason
                assert len(identity_service._CACHE) == 1
            else:
                for task in (owner, waiter):
                    with pytest.raises(failure_type, match="lookup interrupted"):
                        task.result(timeout=5)
                assert identity_service._CACHE == {}
        finally:
            release.set()
    assert len(calls) == 1
    assert identity_service._INFLIGHT == {}
    monkeypatch.setattr(identity_service, "get_rgw_admin_client", lambda **kwargs: SimpleNamespace(get_user_by_access_key=lambda *args, **kw: {"uid": "recovered"}))
    if failure_type not in (None, RGWAdminError):
        assert resolve(connection).iam_identity == "recovered"


@pytest.mark.parametrize("changed_field", ["endpoint_url", "updated_at"])
def test_reconfigured_connection_does_not_wait_for_or_reuse_old_lookup(monkeypatch, changed_field):
    started, release = Event(), Event()
    calls = []

    def lookup(*args, **kwargs):
        index = len(calls)
        calls.append(None)
        if index == 0:
            started.set()
            assert release.wait(5)
        return {"uid": f"user-{index}"}

    monkeypatch.setattr(identity_service, "get_rgw_admin_client", lambda **kwargs: SimpleNamespace(get_user_by_access_key=lookup))
    old_endpoint, new_endpoint = _ceph_endpoint(), _ceph_endpoint()
    old_endpoint.updated_at = new_endpoint.updated_at = datetime(2026, 9, 7, 12, 0, 0, 100, tzinfo=UTC)
    if changed_field == "endpoint_url":
        new_endpoint.endpoint_url = "https://new-endpoint.example.test"
    else:
        new_endpoint.updated_at = new_endpoint.updated_at.replace(microsecond=200)
    old_connection, new_connection = _connection(old_endpoint), _connection(new_endpoint)
    service = ConnectionIdentityService()
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            old = pool.submit(service.resolve_rgw_identity, old_connection)
            assert started.wait(5)
            new = pool.submit(service.resolve_rgw_identity, new_connection)
            assert new.result(timeout=5).iam_identity == "user-1"
            release.set()
            assert old.result(timeout=5).iam_identity == "user-0"
            assert service.resolve_rgw_identity(new_connection).iam_identity == "user-1"
        finally:
            release.set()
    assert len(calls) == 2
    assert identity_service._INFLIGHT == {}


@pytest.mark.parametrize("old_finishes_first", [False, True])
def test_cache_reset_detaches_old_lookups_without_displacing_new_results(monkeypatch, old_finishes_first):
    started = [Event(), Event()]
    release = [Event(), Event()]
    calls = []

    def lookup(*args, **kwargs):
        index = len(calls)
        calls.append(None)
        started[index].set()
        assert release[index].wait(5)
        return {"uid": f"user-{index}"}

    monkeypatch.setattr(identity_service, "get_rgw_admin_client", lambda **kwargs: SimpleNamespace(get_user_by_access_key=lookup))
    connection = _connection(_ceph_endpoint())
    service = ConnectionIdentityService()
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            old = pool.submit(service.resolve_rgw_identity, connection)
            assert started[0].wait(5)
            reset_connection_identity_cache_for_tests()
            new = pool.submit(service.resolve_rgw_identity, connection)
            assert started[1].wait(5)
            if old_finishes_first:
                release[0].set()
                assert old.result(timeout=5).iam_identity == "user-0"
                assert identity_service._CACHE == {}
                assert len(identity_service._INFLIGHT) == 1
            release[1].set()
            assert new.result(timeout=5).iam_identity == "user-1"
            release[0].set()
            assert old.result(timeout=5).iam_identity == "user-0"
            assert service.resolve_rgw_identity(connection).iam_identity == "user-1"
        finally:
            for event in release:
                event.set()
    assert len(calls) == 2
    assert identity_service._INFLIGHT == {}


def test_resolve_metrics_identity_uses_owner_metadata_first():
    endpoint = _ceph_endpoint()
    connection = _connection(
        endpoint,
        owner_type="s3_user",
        owner_identifier="rgw-account$portal-user",
    )

    resolved = ConnectionIdentityService().resolve_metrics_identity(connection)

    assert resolved.eligible is True
    assert resolved.iam_identity == "rgw-account$portal-user"
    assert resolved.rgw_account_id is None
    assert resolved.reason is None


def test_resolve_metrics_identity_uses_admin_lookup_and_caches(monkeypatch):
    endpoint = _ceph_endpoint(name="ceph-cache")
    connection = _connection(endpoint, owner_type=None, owner_identifier=None)
    calls = {"count": 0}

    class _FakeAdmin:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            assert access_key == "AKIA-CONN-TEST"
            assert allow_not_found is True
            calls["count"] += 1
            return {"uid": "RGW12345678901234567$analytics", "account_id": "RGW12345678901234567"}

    monkeypatch.setattr(
        "app.services.connection_identity_service.get_rgw_admin_client",
        lambda **kwargs: _FakeAdmin(),
    )

    service = ConnectionIdentityService()
    first = service.resolve_metrics_identity(connection)
    second = service.resolve_metrics_identity(connection)

    assert first.eligible is True
    assert first.iam_identity == "RGW12345678901234567$analytics"
    assert second.iam_identity == "RGW12345678901234567$analytics"
    assert calls["count"] == 1


def test_resolve_metrics_identity_returns_reason_when_identity_missing(monkeypatch):
    endpoint = _ceph_endpoint(name="ceph-missing-id")
    connection = _connection(endpoint, owner_type="account_user", owner_identifier="RGW00000000000000099")

    class _FakeAdmin:
        def get_user_by_access_key(self, access_key: str, allow_not_found: bool = False):
            return None

    monkeypatch.setattr(
        "app.services.connection_identity_service.get_rgw_admin_client",
        lambda **kwargs: _FakeAdmin(),
    )

    resolved = ConnectionIdentityService().resolve_metrics_identity(connection)

    assert resolved.eligible is False
    assert resolved.iam_identity is None
    assert resolved.reason is not None
    assert "unable to resolve rgw identity" in resolved.reason.lower()
