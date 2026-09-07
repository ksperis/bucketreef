# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import replace

import pytest

from app.db import S3Account, StorageEndpoint
from app.services import browser_service
from app.services.browser import _shared as browser_shared
from app.services.browser import buckets as browser_buckets
from app.services.s3_execution_context import S3ExecutionContext


def _account() -> S3Account:
    account = S3Account(name="browser-cache-test")
    account.id = 101
    account.rgw_access_key = "access-key"
    account.rgw_secret_key = "secret-key"
    account.storage_endpoint = StorageEndpoint(name="browser-cache-test", endpoint_url="https://s3.example.test")
    return account


def _reset_browser_caches() -> None:
    browser_shared._BUCKET_LIST_CACHE.invalidate_where(lambda _key: True)
    browser_shared._OBJECT_LIST_CACHE.invalidate_where(lambda _key: True)
    browser_shared._OBJECT_SORT_SNAPSHOT_CACHE.invalidate_where(lambda _key: True)
    browser_shared._OBJECT_LAZY_HEAD_CACHE.invalidate_where(lambda _key: True)
    browser_shared._OBJECT_LAZY_TAGS_CACHE.invalidate_where(lambda _key: True)


def test_bucket_cache_reused_between_pages(monkeypatch):
    _reset_browser_caches()
    calls: list[dict] = []

    class FakeClient:
        def list_buckets(self):  # noqa: ANN001
            calls.append({"op": "list_buckets"})
            return {
                "Buckets": [
                    {"Name": "alpha"},
                    {"Name": "beta"},
                    {"Name": "gamma"},
                    {"Name": "zeta"},
                ]
            }

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    page_one = service.search_buckets(_account(), page=1, page_size=2)
    page_two = service.search_buckets(_account(), page=2, page_size=2)

    assert [bucket.name for bucket in page_one.items] == ["alpha", "beta"]
    assert [bucket.name for bucket in page_two.items] == ["gamma", "zeta"]
    assert page_one.total == 4
    assert page_two.total == 4
    assert len(calls) == 1


def test_bucket_cache_reused_across_search_terms(monkeypatch):
    _reset_browser_caches()
    calls: list[dict] = []

    class FakeClient:
        def list_buckets(self):  # noqa: ANN001
            calls.append({"op": "list_buckets"})
            return {
                "Buckets": [
                    {"Name": "project-a"},
                    {"Name": "project-b"},
                    {"Name": "archive"},
                ]
            }

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    first = service.search_buckets(_account(), search="project", page=1, page_size=10)
    second = service.search_buckets(_account(), search="archive", page=1, page_size=10)

    assert [bucket.name for bucket in first.items] == ["project-a", "project-b"]
    assert [bucket.name for bucket in second.items] == ["archive"]
    assert len(calls) == 1


def test_bucket_cache_invalidated_after_bucket_mutation(monkeypatch):
    _reset_browser_caches()
    calls: list[dict] = []

    class FakeClient:
        def list_buckets(self):  # noqa: ANN001
            calls.append({"op": "list_buckets"})
            return {"Buckets": [{"Name": "alpha"}]}

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())
    monkeypatch.setattr(service, "_resolve_s3_credentials", lambda _account: ("ak", "sk", None))
    monkeypatch.setattr(browser_buckets, "s3_create_bucket", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(browser_buckets, "s3_set_bucket_versioning", lambda *_args, **_kwargs: None)

    service.search_buckets(_account(), page=1, page_size=10)
    service.create_bucket("new-bucket", _account(), versioning=False)
    service.search_buckets(_account(), page=1, page_size=10)

    assert len(calls) == 2


@pytest.mark.parametrize(
    "changes",
    [
        {"secret_key": "rotated-secret"},
        {"session_token_value": "renewed-session"},
        {"session_region": "us-west-2"},
        {"session_force_path_style": False},
        {"session_verify_tls": False},
        {"context_id": "conn-2"},
        {"context_kind": "session"},
        {"session_endpoint": "https://other.example.test"},
        {"access_key": "rotated-access-key"},
    ],
)
def test_bucket_cache_does_not_reuse_another_execution_configuration(monkeypatch, changes):
    _reset_browser_caches()
    account = S3ExecutionContext(
        context_id="conn-1",
        context_kind="connection",
        name="cache-test",
        access_key="access-key",
        secret_key="secret-key",
        session_token_value="original-session",
        session_endpoint="https://s3.example.test",
        session_region="us-east-1",
        session_force_path_style=True,
        session_verify_tls=True,
    )
    calls = 0

    class FakeClient:
        def list_buckets(self):
            nonlocal calls
            calls += 1
            return {"Buckets": [{"Name": f"result-{calls}"}]}

    service = browser_service.BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    assert service.list_buckets(account)[0].name == "result-1"
    assert service.list_buckets(account)[0].name == "result-1"
    assert service.list_buckets(replace(account, **changes))[0].name == "result-2"
    assert calls == 2
