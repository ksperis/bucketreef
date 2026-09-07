# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from app.db import S3Account, StorageEndpoint, StorageProvider
from app.services import browser_service
from app.services.browser import context as browser_context
from app.services.browser import sts as browser_sts
from app.services.s3_execution_context import S3ExecutionContext


def _account_with_sts_endpoint() -> S3ExecutionContext:
    endpoint = StorageEndpoint(
        name="ceph-sts",
        endpoint_url="https://ceph-sts.example.test",
        provider=StorageProvider.CEPH.value,
        region="us-east-1",
        force_path_style=False,
        verify_tls=True,
        features_config=(
            "features:\n"
            "  sts:\n"
            "    enabled: true\n"
        ),
    )
    account = S3Account(id=1, name="sts-account", rgw_access_key="root", rgw_secret_key="secret")
    account.storage_endpoint = endpoint
    account.storage_endpoint_id = 1
    return S3ExecutionContext.from_account(
        account,
        access_key="root",
        secret_key="secret",
    )


def test_browser_service_prefers_sts_credentials(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()

    def fake_get_session_token(*args, **kwargs):
        return (
            "sts-access",
            "sts-secret",
            "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(hours=1),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None, **kwargs):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        captured["endpoint"] = endpoint
        captured["extra"] = kwargs
        return object()

    monkeypatch.setattr(browser_context, "get_s3_client", fake_get_s3_client)

    service = browser_service.BrowserService()
    service._client(account)

    assert captured["access_key"] == "sts-access"
    assert captured["secret_key"] == "sts-secret"
    assert captured["session_token"] == "sts-token"


def test_browser_service_falls_back_on_sts_error(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    account.access_key = "root-access"
    account.secret_key = "root-secret"
    account.session_token_value = "session-token"

    def fake_get_session_token(*args, **kwargs):
        raise RuntimeError("STS unavailable")

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    captured = {}

    def fake_get_s3_client(access_key, secret_key, endpoint=None, session_token=None, **kwargs):
        captured["access_key"] = access_key
        captured["secret_key"] = secret_key
        captured["session_token"] = session_token
        captured["endpoint"] = endpoint
        captured["extra"] = kwargs
        return object()

    monkeypatch.setattr(browser_context, "get_s3_client", fake_get_s3_client)

    service = browser_service.BrowserService()
    service._client(account)

    assert captured["access_key"] == "root-access"
    assert captured["secret_key"] == "root-secret"
    assert captured["session_token"] == "session-token"


def test_browser_sts_status_and_credentials_share_cached_session(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    calls = 0

    def fake_get_session_token(*args, **kwargs):
        nonlocal calls
        calls += 1
        return (
            "sts-access",
            "sts-secret",
            "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(hours=1),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    service = browser_service.BrowserService()

    assert service.check_sts(account).available is True
    credentials = service.get_sts_credentials(account)

    assert calls == 1
    assert credentials.access_key_id == "sts-access"
    assert credentials.secret_access_key == "sts-secret"
    assert credentials.session_token == "sts-token"
    assert credentials.endpoint == "https://ceph-sts.example.test"


def test_browser_sts_credentials_are_partitioned_by_auth_session(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    calls = 0

    def fake_get_session_token(*args, **kwargs):
        nonlocal calls
        calls += 1
        return (
            f"sts-access-{calls}",
            f"sts-secret-{calls}",
            f"sts-token-{calls}",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    service = browser_service.BrowserService()

    first = service.get_sts_credentials(account, cache_partition="auth-session:first")
    same_session = service.get_sts_credentials(account, cache_partition="auth-session:first")
    second = service.get_sts_credentials(account, cache_partition="auth-session:second")

    assert calls == 2
    assert first.access_key_id == same_session.access_key_id
    assert second.access_key_id != first.access_key_id


def test_browser_sts_requests_minimum_session_duration(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    captured = {}

    def fake_get_session_token(duration_seconds, *args, **kwargs):
        captured["duration_seconds"] = duration_seconds
        return (
            "sts-access",
            "sts-secret",
            "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)

    browser_sts.request_browser_sts_session(account, cache_partition="auth-session:first")

    assert captured["duration_seconds"] == 900


def test_browser_sts_preserves_status_and_credentials_error_contracts(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()

    def fake_get_session_token(*args, **kwargs):
        raise RuntimeError("STS unavailable")

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    service = browser_service.BrowserService()

    status = service.check_sts(account)
    assert status.available is False
    assert status.error == "STS unavailable"
    with pytest.raises(RuntimeError, match="Unable to request STS credentials: STS unavailable"):
        service.get_sts_credentials(account)


@pytest.mark.parametrize(
    "changes",
    [
        {"secret_key": "rotated-secret"},
        {"session_token_value": "renewed-source-token"},
        {"session_region": "eu-west-1"},
        {"session_verify_tls": False},
        {"session_endpoint": "https://other-s3.example.test"},
        {"session_force_path_style": True},
        {"context_id": "another-account"},
        {"context_kind": "portal_account"},
        {"access_key": "rotated-access"},
    ],
)
def test_browser_sts_cache_follows_execution_configuration(monkeypatch, changes):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    calls = 0

    def fake_get_session_token(*args, **kwargs):
        nonlocal calls
        calls += 1
        return (
            f"sts-access-{calls}", "sts-secret", "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    service = browser_service.BrowserService()

    first = service.get_sts_credentials(account, cache_partition="auth-session:first")
    cached = service.get_sts_credentials(account, cache_partition="auth-session:first")
    changed = service.get_sts_credentials(replace(account, **changes), cache_partition="auth-session:first")

    assert first.access_key_id == cached.access_key_id == "sts-access-1"
    assert changed.access_key_id == "sts-access-2"
    assert calls == 2


def test_browser_sts_cache_follows_the_resolved_sts_endpoint(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    endpoints = []

    def fake_get_session_token(*args, endpoint, **kwargs):
        endpoints.append(endpoint)
        return (
            f"sts-access-{len(endpoints)}", "sts-secret", "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    browser_sts.request_browser_sts_session(account)
    account.storage_endpoint.features_config = (
        'features:\n  sts:\n    enabled: true\n    endpoint: https://other-sts.example.test\n'
    )
    browser_sts.request_browser_sts_session(account)

    assert endpoints == ["https://ceph-sts.example.test", "https://other-sts.example.test"]


def test_browser_sts_fallback_logs_context_identity_without_access_key(monkeypatch, caplog):
    browser_sts._STS_CACHE.clear()
    account = replace(
        _account_with_sts_endpoint(),
        id=None,
        context_kind="session",
        context_id="session:external-account",
        access_key="opaque-ceph-access-key",
    )

    def unavailable(*args, **kwargs):
        raise RuntimeError("STS unavailable token=private-token")

    monkeypatch.setattr(browser_sts, "get_session_token", unavailable)
    with caplog.at_level(logging.INFO, logger=browser_context.__name__):
        credentials = browser_service.BrowserService()._resolve_s3_credentials(account)

    assert credentials == ("opaque-ceph-access-key", "secret", None)
    messages = [record.getMessage() for record in caplog.records if record.name == browser_context.__name__]
    assert len(messages) == 1
    assert "session:external-account" in messages[0]
    assert "opaque-ceph-access-key" not in messages[0]
    assert "private-token" not in messages[0]
    assert "token=<redacted>" in messages[0]


@pytest.mark.parametrize(
    ("context_kind", "enabled"),
    [
        ("account", True),
        ("portal_account", True),
        ("session", True),
        ("ceph_admin", True),
        ("connection", False),
        ("s3_user", False),
    ],
)
def test_browser_sts_eligibility_follows_explicit_context_kind(context_kind, enabled):
    account = replace(_account_with_sts_endpoint(), context_kind=context_kind)

    assert browser_sts.browser_sts_enabled(account) is enabled


def test_browser_sts_cache_renews_credentials_within_the_expiration_buffer(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    calls = 0

    def fake_get_session_token(*args, **kwargs):
        nonlocal calls
        calls += 1
        return (
            f"sts-access-{calls}", "sts-secret", "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)
    first = browser_sts.request_browser_sts_session(account)
    assert browser_sts.request_browser_sts_session(account).credentials == first.credentials
    key = next(iter(browser_sts._STS_CACHE))
    browser_sts._STS_CACHE[key] = replace(
        first.credentials, expiration=datetime.now(tz=timezone.utc) + timedelta(minutes=1),
    )

    renewed = browser_sts.request_browser_sts_session(account)

    assert calls == 2
    assert renewed.credentials.access_key_id == "sts-access-2"


def test_browser_sts_cache_purges_expired_entries_from_other_contexts(monkeypatch):
    browser_sts._STS_CACHE.clear()
    account = _account_with_sts_endpoint()
    first_key = browser_sts._sts_cache_key(account, "https://ceph-sts.example.test", None)
    browser_sts._store_sts_credentials(
        first_key,
        browser_sts.CachedStsCredentials(
            "old-access", "old-secret", "old-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        ),
    )
    browser_sts._STS_CACHE[first_key] = replace(
        browser_sts._STS_CACHE[first_key], expiration=datetime.now(tz=timezone.utc) - timedelta(minutes=1),
    )
    monkeypatch.setattr(
        browser_sts, "get_session_token",
        lambda *args, **kwargs: (
            "new-access", "new-secret", "new-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        ),
    )

    browser_sts.request_browser_sts_session(replace(account, context_id="other-account"))

    assert first_key not in browser_sts._STS_CACHE
    assert len(browser_sts._STS_CACHE) == 1


def test_browser_sts_cache_evicts_least_recently_used_entries(monkeypatch):
    browser_sts._STS_CACHE.clear()
    monkeypatch.setattr(browser_sts, "STS_CACHE_MAX_ENTRIES", 2)
    account = _account_with_sts_endpoint()
    calls = 0

    def fake_get_session_token(*args, **kwargs):
        nonlocal calls
        calls += 1
        return (
            f"sts-access-{calls}", "sts-secret", "sts-token",
            datetime.now(tz=timezone.utc) + timedelta(minutes=15),
        )

    monkeypatch.setattr(browser_sts, "get_session_token", fake_get_session_token)

    def read(context_id):
        return browser_sts.request_browser_sts_session(replace(account, context_id=context_id)).credentials.access_key_id

    assert read("first") == "sts-access-1"
    assert read("second") == "sts-access-2"
    assert read("first") == "sts-access-1"
    assert read("third") == "sts-access-3"
    assert len(browser_sts._STS_CACHE) == 2
    assert read("first") == "sts-access-1"
    assert read("second") == "sts-access-4"
    assert len(browser_sts._STS_CACHE) == 2
