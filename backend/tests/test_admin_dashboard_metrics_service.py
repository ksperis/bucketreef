# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timedelta, timezone
from threading import Lock

import pytest


from app.db import S3Account, S3User, StorageEndpoint
from app.services import admin_dashboard_metrics_service as dashboard
from app.services.admin_metrics_service import AdminMetricsService
from app.services.admin_dashboard_metrics_cache import reset_dashboard_metrics_cache
from app.services.rgw_admin import RGWAdminError
from tests.service_identity_helpers import service_identity


@pytest.fixture
def test_engine(dashboard_test_engine):
    return dashboard_test_engine


def endpoint(db, name, *, metrics=True, usage=True, provider="ceph", mode="managed", status="ready", secret="sk", default=False):
    row = StorageEndpoint(
        name=name, endpoint_url=f"https://{name}.test", provider=provider, is_default=default,
        service_identities=[service_identity("supervision", f"supervision-{name}", secret, mode=mode, status=status)],
        features_config=f"features:\n  metrics:\n    enabled: {str(metrics).lower()}\n  usage:\n    enabled: {str(usage).lower()}\n",
        admin_access_key="must-not-be-used", admin_secret_key="must-not-be-used",
    )
    db.add(row)
    db.flush()
    db.add(S3Account(name=f"Account {name}", rgw_account_id=f"account-{name}", rgw_user_uid="same-root", storage_endpoint_id=row.id))
    db.commit()
    return row


def bucket(name, owner="same-account", size=100, objects=10, tenant=""):
    return {"bucket": name, "owner": owner, "tenant": tenant, "usage": {"total_bytes": size, "total_objects": objects}}


class RGW:
    def __init__(self, buckets=None, entries=None):
        self.buckets = buckets if buckets is not None else []
        self.entries = entries if entries is not None else []
        self.calls = []

    def get_all_buckets(self, **kwargs):
        self.calls.append(kwargs)
        return self.buckets

    def get_usage(self, **kwargs):
        self.calls.append(kwargs)
        return {"entries": self.entries}


class FailedRGW(RGW):
    def get_all_buckets(self, **kwargs):
        raise RGWAdminError("https://internal.test/admin?X-Amz-Signature=sig secret_key=private-secret access_key=private-key")

    def get_usage(self, **kwargs):
        raise RGWAdminError("secret_key=private-secret access_key=private-key")


def test_scope_includes_managed_and_external_without_default_or_admin_dependency(db_session):
    one = endpoint(db_session, "one")
    two = endpoint(db_session, "two", metrics=False, mode="external")
    endpoint(db_session, "default", metrics=False, usage=False, default=True)
    endpoint(db_session, "not-ready", status="error")
    endpoint(db_session, "no-secret", secret=None)
    endpoint(db_session, "aws", provider="aws", metrics=False, usage=False)
    one.admin_access_key = one.admin_secret_key = None
    db_session.commit()
    assert dashboard.AdminDashboardMetricsService(db_session).scope() == {"endpoints": [
        {"endpoint_id": one.id, "name": "one", "storage_enabled": True, "traffic_enabled": True},
        {"endpoint_id": two.id, "name": "two", "storage_enabled": False, "traffic_enabled": True},
    ]}


def test_storage_aggregates_scoped_owners_and_does_not_merge_identical_buckets_across_endpoints(db_session, monkeypatch):
    one = endpoint(db_session, "one")
    two = endpoint(db_session, "two", mode="external")
    endpoint(db_session, "traffic-only", metrics=False)
    db_session.add(S3User(name="User", rgw_user_uid="registered-user", rgw_access_key="a", rgw_secret_key="s", storage_endpoint_id=one.id))
    db_session.commit()
    clients = {
        one.id: RGW([bucket("same-bucket", "account-one"), bucket("user-bucket", "registered-user", 25, 3), bucket("foreign", "unknown", 999, 999)]),
        two.id: RGW([bucket("same-bucket", "account-two", size=50, objects=5)]),
    }
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: clients[e.id])
    result = dashboard.AdminDashboardMetricsService(db_session).storage()
    assert result["storage_totals"] == {"bucket_count": 3, "used_bytes": 175, "object_count": 18}
    assert result["coverage"] == {"eligible_count": 2, "contributing_count": 2, "complete_count": 2, "issues": []}
    assert all(c.calls == [{"with_stats": True}] for c in clients.values())


def test_storage_partial_failure_absence_zero_and_sanitization(db_session, monkeypatch):
    one = endpoint(db_session, "one")
    two = endpoint(db_session, "two")
    clients = {one.id: RGW([]), two.id: FailedRGW()}
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: clients[e.id])
    service = dashboard.AdminDashboardMetricsService(db_session)
    result = service.storage()
    assert result["storage_totals"] == {"bucket_count": 0, "used_bytes": 0, "object_count": 0}
    assert result["coverage"]["contributing_count"] == 1
    assert result["coverage"]["complete_count"] == 1
    assert result["coverage"]["issues"][0]["name"] == "two"
    assert "private-secret" not in str(result)
    assert "private-key" not in str(result)
    assert "internal.test" not in str(result)
    clients[one.id] = FailedRGW()
    reset_dashboard_metrics_cache()
    assert service.storage()["storage_totals"] == dict.fromkeys(dashboard.STORAGE_FIELDS)
    reset_dashboard_metrics_cache()
    clients[one.id] = RGW([{"bucket": "no-stats", "owner": "account-one"}])
    result = service.storage()
    assert result["storage_totals"] == {"bucket_count": 1, "used_bytes": None, "object_count": None}
    assert result["measurements"]["bucket_count"]["complete_count"] == 1
    assert result["coverage"]["complete_count"] == 0


def test_storage_fallback_deduplicates_principals_and_overlapping_buckets_and_reports_missing_users(db_session):
    row = endpoint(db_session, "fallback")
    db_session.add_all([
        S3User(name="Root", rgw_user_uid="same-root", rgw_access_key="a", rgw_secret_key="s", storage_endpoint_id=row.id),
        S3User(name="Member", rgw_user_uid="member", rgw_access_key="a", rgw_secret_key="s", storage_endpoint_id=row.id),
        S3User(name="Missing", rgw_user_uid="missing", rgw_access_key="a", rgw_secret_key="s", storage_endpoint_id=row.id),
    ])
    db_session.commit()

    class FallbackRGW(RGW):
        def get_all_buckets(self, uid=None, **kwargs):
            self.calls.append(uid)
            if uid is None or uid == "missing":
                raise RGWAdminError("Listing unavailable")
            return [bucket("shared"), bucket(f"{uid}-only")]

    client = FallbackRGW()
    result = AdminMetricsService(db_session, client, row.id).dashboard_storage()
    assert result["storage_totals"] == {"bucket_count": 3, "used_bytes": 300, "object_count": 30}
    assert client.calls.count("same-root") == 1
    assert not any(result["complete"].values())
    assert result["reason"] == "Listing unavailable"


def test_storage_fallback_can_recover_completely_and_empty_registered_scope_is_zero(db_session):
    row = endpoint(db_session, "fallback")

    class FallbackRGW(RGW):
        def get_all_buckets(self, uid=None, **kwargs):
            if uid is None:
                raise RGWAdminError("Consolidated listing unavailable")
            return []

    result = AdminMetricsService(db_session, FallbackRGW(), row.id).dashboard_storage()
    assert result["storage_totals"] == {"bucket_count": 0, "used_bytes": 0, "object_count": 0}
    assert all(result["complete"].values())
    assert result["reason"] is None
    result = AdminMetricsService(db_session, FailedRGW(), -1).dashboard_storage()
    assert all(result["complete"].values())
    assert result["storage_totals"]["used_bytes"] == 0


def usage(user, stamp, ops, success):
    return {"user": user, "bucket": "same-bucket", "time": stamp, "categories": [{"category": "get_obj", "ops": ops, "successful_ops": success, "bytes_sent": ops * 2, "bytes_received": ops}]}


def test_traffic_uses_common_24h_window_filters_and_weighted_success_and_hourly_sums(db_session, monkeypatch):
    one = endpoint(db_session, "one")
    two = endpoint(db_session, "two")
    endpoint(db_session, "storage-only", usage=False)
    now = datetime.now(timezone.utc) - timedelta(minutes=1)
    stamp = now.isoformat()
    clients = {
        one.id: RGW(entries=[usage("same-root", stamp, 10, 5), usage("foreign", stamp, 999, 999), usage("same-root", "2000-01-01T00:00:00Z", 999, 999)]),
        two.id: RGW(entries=[usage("same-root", stamp, 90, 90)]),
    }
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: clients[e.id])
    result = dashboard.AdminDashboardMetricsService(db_session).traffic()
    assert result["totals"] == {"ops": 100, "success_ops": 95, "bytes_in": 100, "bytes_out": 200, "success_rate": .95}
    assert len(result["series"]) == 1
    assert result["series"][0]["ops"] == 100
    assert clients[one.id].calls[-1] == clients[two.id].calls[-1]
    assert (clients[one.id].calls[-1]["end"] - clients[one.id].calls[-1]["start"]).total_seconds() == 86400


def test_traffic_failures_do_not_turn_into_zero(db_session, monkeypatch):
    one = endpoint(db_session, "one")
    two = endpoint(db_session, "two")
    clients = {one.id: RGW(), two.id: FailedRGW()}
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: clients[e.id])
    service = dashboard.AdminDashboardMetricsService(db_session)
    assert service.traffic()["totals"]["ops"] == 0
    clients[one.id] = FailedRGW()
    reset_dashboard_metrics_cache()
    result = service.traffic()
    assert result["totals"]["ops"] is None
    assert result["series"] == []
    assert result["coverage"]["contributing_count"] == 0
    assert "private-secret" not in str(result)


def test_empty_scope_and_new_routes_preserve_existing_endpoint_resolution(client, db_session, monkeypatch):
    for suffix in ("scope", "storage", "traffic"):
        response = client.get(f"/api/admin/stats/dashboard/{suffix}")
        assert response.status_code == 200
    assert client.get("/api/admin/stats/dashboard/storage").json()["storage_totals"]["bucket_count"] is None
    assert client.get("/api/admin/stats/storage").status_code == 400
    default = endpoint(db_session, "default", metrics=False, usage=False, default=True)
    supervised = endpoint(db_session, "supervised")
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: RGW())
    assert client.get("/api/admin/stats/dashboard/storage").json()["coverage"]["eligible_count"] == 1
    assert client.get("/api/admin/stats/storage").status_code == 403
    from app.routers.admin import stats
    assert stats._resolve_endpoint(db_session, None).id == default.id
    assert client.get("/api/admin/stats/dashboard/scope").json()["endpoints"][0]["endpoint_id"] == supervised.id


def test_workers_own_sessions_and_concurrency_is_bounded(db_session, monkeypatch):
    for i in range(6):
        endpoint(db_session, f"endpoint-{i}")
    sessions = []
    lock = Lock()
    original = AdminMetricsService.dashboard_storage

    def collect(service):
        with lock:
            sessions.append(service.db)
        return original(service)

    monkeypatch.setattr(AdminMetricsService, "dashboard_storage", collect)
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda e: RGW())
    service = dashboard.AdminDashboardMetricsService(db_session)
    real_executor = dashboard.ThreadPoolExecutor
    sizes = []

    def executor(**kwargs):
        sizes.append(kwargs["max_workers"])
        return real_executor(**kwargs)

    monkeypatch.setattr(dashboard, "ThreadPoolExecutor", executor)
    assert service.storage()["coverage"]["complete_count"] == 6
    assert sizes == [4]
    assert len({id(session) for session in sessions}) == 6
    assert all(session is not db_session for session in sessions)


def test_malformed_storage_responses_are_unavailable_not_empty(db_session):
    row = endpoint(db_session, "malformed")
    for payload in ({}, None, {"buckets": "unavailable"}, [{}]):
        class MalformedRGW(RGW):
            def get_all_buckets(self, **kwargs):
                return payload

        result = AdminMetricsService(db_session, MalformedRGW(), row.id).dashboard_storage()
        assert result["storage_totals"] == dict.fromkeys(dashboard.STORAGE_FIELDS)
        assert not any(result["complete"].values())
        assert result["reason"]


def test_endpoint_feature_change_during_collection_is_reported(db_session, monkeypatch):
    row = endpoint(db_session, "changed")
    service = dashboard.AdminDashboardMetricsService(db_session)
    target = service.scope()["endpoints"][0]
    row.features_config = "features:\n  metrics:\n    enabled: false\n  usage:\n    enabled: false\n"
    db_session.commit()
    monkeypatch.setattr(dashboard, "get_supervision_rgw_client", lambda endpoint: pytest.fail("Disabled endpoint must not call RGW"))
    result = service._collect_endpoint(target, "storage", datetime.now(timezone.utc))
    assert "configuration changed" in result["reason"]


def test_dashboard_routes_require_admin_authentication(client):
    from app.main import app
    from app.routers.dependencies import get_current_super_admin

    override = app.dependency_overrides.pop(get_current_super_admin)
    try:
        for suffix in ("scope", "storage", "traffic"):
            assert client.get(f"/api/admin/stats/dashboard/{suffix}").status_code in (401, 403)
    finally:
        app.dependency_overrides[get_current_super_admin] = override


def test_collectors_use_supervision_credentials_and_never_admin_ops(db_session, monkeypatch):
    row = endpoint(db_session, "supervision-only")
    calls = []

    def factory(**kwargs):
        calls.append(kwargs)
        return RGW()

    monkeypatch.setattr("app.services.rgw_supervision.get_rgw_admin_client", factory)
    service = dashboard.AdminDashboardMetricsService(db_session)
    assert service.storage()["coverage"]["complete_count"] == 1
    assert service.traffic()["coverage"]["complete_count"] == 1
    assert len(calls) == 2
    assert all(call["access_key"] == "supervision-supervision-only" and call["secret_key"] == "sk" for call in calls)
    row.service_identity("supervision").status = "error"
    db_session.commit()
    assert service.storage()["coverage"]["eligible_count"] == 0
    assert len(calls) == 2
