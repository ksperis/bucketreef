# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from threading import Barrier, Event
from unittest.mock import Mock

import pytest

from app.db import S3Account, S3User
from app.services import admin_dashboard_metrics_cache as cache
from app.services import admin_dashboard_metrics_service as dashboard
from tests.test_admin_dashboard_metrics_service import FailedRGW, RGW, endpoint


@pytest.fixture
def test_engine(dashboard_test_engine):
    return dashboard_test_engine


def snapshot(*, eligible=2, contributors=2):
    return {
        "generated_at": "2026-10-05T08:00:00+00:00",
        "start": "2026-10-04T08:00:00+00:00", "end": "2026-10-05T08:00:00+00:00",
        "coverage": {"eligible_count": eligible, "contributing_count": contributors, "issues": []},
        "totals": {"ops": 0 if contributors else None},
        "series": [{"ops": 0}],
    }


@pytest.mark.parametrize("eligible,contributors,ttl", [(2, 2, 1800), (2, 1, 1800), (2, 0, 60), (0, 0, 1800)])
def test_cache_ttl_starts_after_collection_and_preserves_zero_partial_absent_and_dates(monkeypatch, eligible, contributors, ttl):
    now = [10.0]
    monkeypatch.setattr(cache, "monotonic", lambda: now[0])
    payload = snapshot(eligible=eligible, contributors=contributors)

    def collect():
        now[0] += 20
        return payload

    builder = Mock(side_effect=collect)
    before = datetime.now(timezone.utc).timestamp()
    first = cache.get_cached_dashboard_metrics("traffic", "scope", builder)
    expires = datetime.fromisoformat(first["cache"]["expires_at"])
    assert expires.tzinfo == timezone.utc
    assert before + ttl <= expires.timestamp() <= datetime.now(timezone.utc).timestamp() + ttl
    assert first["cache"]["hit"] is False
    first["series"][0]["ops"] = 999
    first["coverage"]["issues"].append("consumer mutation")
    payload["totals"]["ops"] = 888
    now[0] = 30 + ttl - .001
    hit = cache.get_cached_dashboard_metrics("traffic", "scope", builder)
    assert hit["cache"] == {"hit": True, "expires_at": first["cache"]["expires_at"]}
    assert hit["series"][0]["ops"] == 0
    assert hit["coverage"]["issues"] == []
    assert hit["totals"]["ops"] == (0 if contributors else None)
    assert hit["start"] == first["start"] and hit["end"] == first["end"]
    assert builder.call_count == 1
    now[0] += .001
    assert cache.get_cached_dashboard_metrics("traffic", "scope", builder)["cache"]["hit"] is False
    assert builder.call_count == 2


def test_metric_caches_are_independent_and_bounded(monkeypatch):
    builder = Mock(side_effect=snapshot)
    assert not cache.get_cached_dashboard_metrics("storage", "scope", builder)["cache"]["hit"]
    assert not cache.get_cached_dashboard_metrics("traffic", "scope", builder)["cache"]["hit"]
    assert cache.get_cached_dashboard_metrics("storage", "scope", builder)["cache"]["hit"]
    assert builder.call_count == 2
    for i in range(70):
        cache.get_cached_dashboard_metrics("storage", str(i), builder)
    assert len(cache._CACHE) == 64
    assert ("storage", "0") not in cache._CACHE


def test_concurrent_requests_share_collection_and_receive_independent_responses():
    barrier = Barrier(8)
    entered, release = Event(), Event()

    def collect():
        entered.set()
        assert release.wait(5)
        return snapshot()

    builder = Mock(side_effect=collect)

    def request():
        barrier.wait(timeout=5)
        return cache.get_cached_dashboard_metrics("storage", "scope", builder)

    with ThreadPoolExecutor(max_workers=8) as executor:
        pending = [executor.submit(request) for _ in range(8)]
        assert entered.wait(5)
        release.set()
        results = [future.result(timeout=5) for future in pending]
    assert builder.call_count == 1
    assert sum(not result["cache"]["hit"] for result in results) == 1
    results[0]["series"][0]["ops"] = 99
    assert all(result["series"][0]["ops"] == 0 for result in results[1:])


def test_raised_collection_cleans_inflight_and_allows_retry():
    builder = Mock(side_effect=[RuntimeError("collection interrupted"), snapshot()])
    with pytest.raises(RuntimeError, match="collection interrupted"):
        cache.get_cached_dashboard_metrics("storage", "scope", builder)
    assert cache._INFLIGHT == {}
    assert cache._CACHE == {}
    assert cache.get_cached_dashboard_metrics("storage", "scope", builder)["cache"]["hit"] is False
    assert builder.call_count == 2


def test_reset_during_collection_does_not_repopulate_cache():
    entered, release = Event(), Event()

    def collect():
        entered.set()
        assert release.wait(5)
        return snapshot()

    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(cache.get_cached_dashboard_metrics, "storage", "scope", collect)
        assert entered.wait(5)
        cache.reset_dashboard_metrics_cache()
        release.set()
        assert pending.result(timeout=5)["cache"]["hit"] is False
    assert cache._CACHE == {}
    assert cache._INFLIGHT == {}


def test_service_instances_and_routes_reuse_metrics_without_rgw_calls(db_session, monkeypatch, client):
    row = endpoint(db_session, "one")
    rgw = RGW()
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: rgw)
    service = dashboard.AdminDashboardMetricsService(db_session)
    first = service.storage()
    assert not first["cache"]["hit"]
    assert service.storage()["cache"]["hit"]
    assert dashboard.AdminDashboardMetricsService(db_session).storage()["cache"]["hit"]
    response = client.get("/api/admin/stats/dashboard/storage").json()
    assert response["cache"]["hit"]
    assert response["generated_at"] == first["generated_at"]
    assert rgw.calls == [{"with_stats": True}]
    traffic = service.traffic()
    hits = deepcopy(rgw.calls)
    assert dashboard.AdminDashboardMetricsService(db_session).traffic()["end"] == traffic["end"]
    assert rgw.calls == hits
    row.service_identity("supervision").status = "error"
    db_session.commit()
    assert service.scope() == {"endpoints": []}
    assert service.storage()["coverage"]["eligible_count"] == 0
    assert rgw.calls == hits


@pytest.mark.parametrize("change", [
    "supervision_status", "supervision_mode", "rotate_access", "rotate_secret", "missing_credentials",
    "metrics_disabled", "usage_disabled", "rgw_configuration", "endpoint_url", "tls", "region",
    "account_add", "account_remove", "account_move", "account_identifier",
    "user_add", "user_remove", "user_move", "user_identifier",
])
def test_database_scope_changes_invalidate_without_secrets(db_session, monkeypatch, change):
    one, two = endpoint(db_session, "one"), endpoint(db_session, "two")
    user = S3User(name="User", rgw_user_uid="tracked-user", rgw_access_key="a", rgw_secret_key="s", storage_endpoint_id=one.id)
    db_session.add(user)
    db_session.commit()
    account = db_session.query(S3Account).filter_by(storage_endpoint_id=one.id).one()
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: RGW())
    service = dashboard.AdminDashboardMetricsService(db_session)
    first_keys = {kind: service._cache_scope(kind)[1] for kind in ("storage", "traffic")}
    service.storage()
    service.traffic()
    identity = one.service_identity("supervision")
    if change == "supervision_status": identity.status = "error"
    elif change == "supervision_mode": identity.mode = "external"
    elif change == "rotate_access": identity.access_key = "new-sensitive-access"
    elif change == "rotate_secret": identity.secret_key = "new-sensitive-secret"
    elif change == "missing_credentials": identity.secret_key = None
    elif change == "metrics_disabled": one.features_config = "features:\n  metrics:\n    enabled: false\n  usage:\n    enabled: true\n"
    elif change == "usage_disabled": one.features_config = "features:\n  metrics:\n    enabled: true\n  usage:\n    enabled: false\n"
    elif change == "rgw_configuration": one.features_config += "  admin:\n    endpoint: https://new-rgw.test\n"
    elif change == "endpoint_url": one.endpoint_url = "https://new-endpoint.test"
    elif change == "tls": one.verify_tls = False
    elif change == "region": one.region = "new-region"
    elif change == "account_add": db_session.add(S3Account(name="New", rgw_account_id="new-account", rgw_user_uid="new-root", storage_endpoint_id=one.id))
    elif change == "account_remove": db_session.delete(account)
    elif change == "account_move": account.storage_endpoint_id = two.id
    elif change == "account_identifier": account.rgw_user_uid = "changed-root"
    elif change == "user_add": db_session.add(S3User(name="New", rgw_user_uid="new-user", rgw_access_key="a", rgw_secret_key="s", storage_endpoint_id=one.id))
    elif change == "user_remove": db_session.delete(user)
    elif change == "user_move": user.storage_endpoint_id = two.id
    elif change == "user_identifier": user.rgw_user_uid = "changed-user"
    db_session.commit()
    for kind in ("storage", "traffic"):
        assert service._cache_scope(kind)[1] != first_keys[kind]
        result = getattr(service, kind)()
        assert result["cache"]["hit"] is False
        assert getattr(service, kind)()["cache"]["hit"] is True
    assert "new-sensitive" not in str(cache._CACHE)
    assert "must-not-be-used" not in str(cache._CACHE)


def test_failed_service_result_is_sanitized_and_cached_for_only_one_minute(db_session, monkeypatch):
    endpoint(db_session, "one")
    now = [0.0]
    monkeypatch.setattr(cache, "monotonic", lambda: now[0])
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: FailedRGW())
    service = dashboard.AdminDashboardMetricsService(db_session)
    first = service.traffic()
    assert first["totals"]["ops"] is None
    assert "private-secret" not in str(cache._CACHE)
    now[0] = 59
    assert service.traffic()["cache"]["hit"]
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: RGW())
    now[0] = 60
    recovered = service.traffic()
    assert not recovered["cache"]["hit"]
    assert recovered["totals"]["ops"] == 0


@pytest.mark.parametrize("kind", ["storage", "traffic"])
def test_partial_service_results_preserve_warnings_for_thirty_minutes(db_session, monkeypatch, kind):
    one, two = endpoint(db_session, "one"), endpoint(db_session, "two")
    clients = {one.id: RGW(), two.id: FailedRGW()}
    now = [0.0]
    monkeypatch.setattr(cache, "monotonic", lambda: now[0])
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: clients[e.id])
    service = dashboard.AdminDashboardMetricsService(db_session)
    first = getattr(service, kind)()
    assert first["coverage"]["contributing_count"] == 1
    assert first["coverage"]["issues"][0]["name"] == "two"
    clients[two.id] = RGW()
    now[0] = 1799
    hit = getattr(service, kind)()
    assert hit["cache"]["hit"]
    assert hit["coverage"] == first["coverage"]
    now[0] = 1800
    recovered = getattr(service, kind)()
    assert not recovered["cache"]["hit"]
    assert recovered["coverage"]["complete_count"] == 2


def test_concurrent_service_instances_share_one_rgw_collection(db_session, monkeypatch):
    endpoint(db_session, "one")
    factory = dashboard.AdminDashboardMetricsService(db_session).session_factory
    barrier = Barrier(6)
    entered, release = Event(), Event()

    class SlowRGW(RGW):
        def get_all_buckets(self, **kwargs):
            entered.set()
            assert release.wait(5)
            return super().get_all_buckets(**kwargs)

    rgw = SlowRGW()
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: rgw)

    def request():
        with factory() as db:
            barrier.wait(timeout=5)
            return dashboard.AdminDashboardMetricsService(db).storage()

    with ThreadPoolExecutor(max_workers=6) as executor:
        pending = [executor.submit(request) for _ in range(6)]
        assert entered.wait(5)
        release.set()
        results = [future.result(timeout=5) for future in pending]
    assert rgw.calls == [{"with_stats": True}]
    assert sum(not result["cache"]["hit"] for result in results) == 1
