# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from fastapi import HTTPException

from app.utils.time import utcnow
from datetime import date, datetime, timedelta

import pytest

from app.core.domain_errors import CostSubjectNotFoundError
from app.db import CostEndpointOverride, CostModel, CostStorageDaily, CostUsageDaily, S3Account, S3User, StorageEndpoint, User
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from app.models.app_settings import AppSettings
from app.models.cost import CostEndpointCollectionError
from app.main import app
from app.routers.manager.cost import manager_cost_me
from app.routers.portal_cost import portal_cost_me
from app.services import admin_cost_service
from app.services.admin_cost_service import AdminCostService
from app.services.cost_collection_service import CostCollector
from app.services.cost_calculations import parse_cost_month, parse_ops_breakdown
from app.services.cost_service import CostService
from app.services.s3_execution_context import S3ExecutionContext


def _seed_endpoint(db_session) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name="ceph-prod",
        endpoint_url="http://rgw.local",
        provider="ceph",
        is_default=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def _seed_account(db_session, endpoint_id: int) -> S3Account:
    account = S3Account(
        name="acme",
        rgw_account_id="RGW12345678901234567",
        rgw_user_uid="rgw12345678901234567-admin",
        storage_endpoint_id=endpoint_id,
    )
    db_session.add(account)
    db_session.commit()
    return account


def _seed_s3_user(db_session, endpoint_id: int) -> S3User:
    user = S3User(
        name="cost-user",
        rgw_user_uid="cost-user",
        rgw_access_key="COST-AK",
        rgw_secret_key="COST-SK",
        storage_endpoint_id=endpoint_id,
        allow_cost_estimation=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _enabled_cost_settings() -> AppSettings:
    settings = AppSettings()
    settings.general.cost_enabled = True
    return settings


def test_manager_cost_requires_targeted_subject_opt_in(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    settings = _enabled_cost_settings()
    monkeypatch.setattr(
        "app.routers.manager.cost.load_app_settings_for_db_readonly",
        lambda _db: settings,
    )
    context = S3ExecutionContext.from_account(account)

    with pytest.raises(HTTPException) as exc_info:
        manager_cost_me(month="2026-01", context=context, db=db_session)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Cost estimation is disabled for this Manager context"


def test_manager_cost_returns_estimate_after_targeted_opt_in(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    account.allow_cost_estimation = True
    db_session.commit()
    settings = _enabled_cost_settings()
    monkeypatch.setattr(
        "app.routers.manager.cost.load_app_settings_for_db_readonly",
        lambda _db: settings,
    )
    captured = {}
    monkeypatch.setattr(
        "app.routers.manager.cost.CostService.subject_detail",
        lambda _self, month, endpoint_id, subject_type, subject_id: captured.update(
            month=month,
            endpoint_id=endpoint_id,
            subject_type=subject_type,
            subject_id=subject_id,
        ) or SimpleNamespace(subject_id=subject_id),
    )

    result = manager_cost_me(
        month="2026-01",
        context=S3ExecutionContext.from_account(account),
        db=db_session,
    )

    assert result.subject_id == account.id
    assert captured == {
        "month": "2026-01",
        "endpoint_id": endpoint.id,
        "subject_type": "account",
        "subject_id": account.id,
    }


def test_manager_cost_returns_estimate_for_opted_in_s3_user(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    user = _seed_s3_user(db_session, endpoint.id)
    monkeypatch.setattr(
        "app.routers.manager.cost.load_app_settings_for_db_readonly",
        lambda _db: _enabled_cost_settings(),
    )
    captured = {}
    monkeypatch.setattr(
        "app.routers.manager.cost.CostService.subject_detail",
        lambda _self, month, endpoint_id, subject_type, subject_id: captured.update(
            month=month,
            endpoint_id=endpoint_id,
            subject_type=subject_type,
            subject_id=subject_id,
        ) or SimpleNamespace(subject_id=subject_id),
    )

    result = manager_cost_me(
        month="2026-01",
        context=S3ExecutionContext.from_s3_user(user),
        db=db_session,
    )

    assert result.subject_id == user.id
    assert captured == {
        "month": "2026-01",
        "endpoint_id": endpoint.id,
        "subject_type": "s3_user",
        "subject_id": user.id,
    }


def test_portal_cost_requires_project_opt_in(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    user = User(email="cost-portal@example.test", hashed_password="x", role="ui_user")
    db_session.add(user)
    db_session.commit()
    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        capabilities=AccountCapabilities(),
        portal_role="portal_user",
    )
    monkeypatch.setattr(
        "app.routers.portal_cost.load_app_settings_for_db_readonly",
        lambda _db: _enabled_cost_settings(),
    )
    monkeypatch.setattr(
        "app.routers.portal_cost.PortalService.get_effective_portal_settings",
        lambda _self, _account: SimpleNamespace(cost_estimation_enabled=False),
    )

    with pytest.raises(HTTPException) as exc_info:
        portal_cost_me(month="2026-01", access=access, db=db_session)

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Cost estimation is disabled for this Portal project"


def test_portal_cost_returns_estimate_after_project_opt_in(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    user = User(email="cost-portal-opt-in@example.test", hashed_password="x", role="ui_user")
    db_session.add(user)
    db_session.commit()
    access = AccountAccess(
        account=account,
        actor=user,
        membership=None,
        capabilities=AccountCapabilities(),
        portal_role="portal_user",
    )
    monkeypatch.setattr(
        "app.routers.portal_cost.load_app_settings_for_db_readonly",
        lambda _db: _enabled_cost_settings(),
    )
    monkeypatch.setattr(
        "app.routers.portal_cost.PortalService.get_effective_portal_settings",
        lambda _self, _account: SimpleNamespace(cost_estimation_enabled=True),
    )
    captured = {}
    monkeypatch.setattr(
        "app.routers.portal_cost.CostService.subject_detail",
        lambda _self, month, endpoint_id, subject_type, subject_id: captured.update(
            month=month,
            endpoint_id=endpoint_id,
            subject_type=subject_type,
            subject_id=subject_id,
        ) or SimpleNamespace(subject_id=subject_id),
    )

    result = portal_cost_me(month="2026-01", access=access, db=db_session)

    assert result.subject_id == account.id
    assert captured == {
        "month": "2026-01",
        "endpoint_id": endpoint.id,
        "subject_type": "account",
        "subject_id": account.id,
    }


def test_parse_cost_month():
    period = parse_cost_month("2026-01")
    assert period.start == date(2026, 1, 1)
    assert period.end == date(2026, 2, 1)
    assert period.days_in_month == 31


def test_cost_collection_returns_structured_errors_without_exception_detail(db_session, monkeypatch):
    endpoint = StorageEndpoint(
        name="cost-error-endpoint",
        endpoint_url="https://cost-error.example.test",
        provider="ceph",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    class GeneralSettings:
        cost_enabled = True

    class AppSettings:
        general = GeneralSettings()

    monkeypatch.setattr("app.services.app_settings_service.load_app_settings_for_db_readonly", lambda _db: AppSettings())
    monkeypatch.setattr(
        "app.services.cost_collection_service.get_supervision_rgw_client",
        lambda _endpoint: (_ for _ in ()).throw(RuntimeError("secret upstream detail")),
    )
    monkeypatch.setattr(
        "app.services.cost_collection_service.DataRetentionService.purge_all",
        lambda _self: {
            "quota_history": {
                "hourly_retention_days": 30,
                "daily_retention_days": 365,
                "deleted_hourly": 0,
                "deleted_daily": 0,
            },
            "cost_history": {
                "daily_retention_days": 365,
                "deleted_usage_daily": 0,
                "deleted_storage_daily": 0,
            },
        },
    )

    result = CostCollector(db_session).collect_daily(date(2026, 9, 25))

    assert result.errors == [
        CostEndpointCollectionError(
            stage="endpoint",
            endpoint_id=endpoint.id,
        )
    ]
    assert "secret upstream detail" not in repr(result)


def test_cost_usage_collection_uses_half_open_daily_window(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    collector = CostCollector(db_session)
    subject = collector._load_subjects(endpoint)[0]
    start = datetime(2026, 1, 1)
    end = start + timedelta(days=1)
    captured: dict[str, datetime] = {}

    class FakeRgwAdmin:
        def get_usage(self, **_kwargs):
            return []

    def fake_aggregate(_entries, *, start, end):
        captured["start"] = start
        captured["end"] = end
        return {"totals": {}, "category_breakdown": []}

    monkeypatch.setattr(
        "app.services.cost_collection_service.aggregate_usage",
        fake_aggregate,
    )
    monkeypatch.setattr(collector, "_upsert_usage", lambda **_kwargs: None)

    collector._collect_usage_subject(
        FakeRgwAdmin(), endpoint, date(2026, 1, 1), start, end, subject
    )

    assert captured == {
        "start": start,
        "end": end - timedelta(microseconds=1),
    }


def test_cost_bucket_stats_accept_explicit_empty_usage_map(db_session):
    collector = CostCollector(db_session)

    class FakeRgwAdmin:
        def get_all_buckets(self, **_kwargs):
            return [{"bucket": "empty", "usage": {}}]

    total_bytes, total_objects, _by_bucket = collector._collect_bucket_stats(
        FakeRgwAdmin(), "empty-user"
    )

    assert total_bytes == 0
    assert total_objects == 0


def test_cost_bucket_stats_reject_incomplete_measurement(db_session, monkeypatch):
    collector = CostCollector(db_session)

    class FakeRgwAdmin:
        def get_all_buckets(self, **_kwargs):
            return [{"bucket": "partial", "usage": {"rgw.main": {"size": 42}}}]

    monkeypatch.setattr(
        "app.services.cost_collection_service.extract_usage_stats",
        lambda _usage: (42, None),
    )

    with pytest.raises(ValueError, match="RGW bucket statistics are incomplete"):
        collector._collect_bucket_stats(FakeRgwAdmin(), "partial-user")


def test_cost_ops_breakdown_requires_integer_values():
    assert parse_ops_breakdown('{"get":12,"put":3}') == {
        "get": 12,
        "put": 3,
    }
    for raw in ("{", "[]", '{"get":"12"}', '{"get":true}'):
        with pytest.raises(ValueError):
            parse_ops_breakdown(raw)


def test_cost_summary_and_cost(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    day_one = date(2026, 1, 10)
    day_two = date(2026, 1, 11)

    db_session.add_all(
        [
            CostUsageDaily(
                day=day_one,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=1024,
                bytes_out=2048,
                ops_total=1000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostUsageDaily(
                day=day_two,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=2048,
                bytes_out=4096,
                ops_total=500,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostStorageDaily(
                day=day_one,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=100,
                total_objects=10,
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            ),
            CostStorageDaily(
                day=day_two,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=300,
                total_objects=20,
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            ),
        ]
    )

    model = CostModel(
        id=1,
        currency="EUR",
        storage_gb_month_price=1.0,
        egress_gb_price=2.0,
        ingress_gb_price=0.5,
        requests_per_1000_price=3.0,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(model)
    db_session.commit()

    service = CostService(db_session)
    summary = service.summary("2026-01", endpoint.id)

    assert summary.usage.bytes_in == 3072
    assert summary.usage.bytes_out == 6144
    assert summary.usage.ops_total == 1500
    assert summary.storage.avg_bytes == 200
    assert summary.coverage.days_collected == 2
    assert summary.coverage.storage_days_collected == 2
    assert summary.coverage.usage_days_collected == 2

    assert summary.cost is not None
    assert summary.cost.currency == "EUR"
    assert summary.cost.pricing_source == "global"
    assert summary.cost.total_cost is not None
    assert summary.cost.total_cost > 0


def test_cost_endpoint_override_completely_replaces_global_rates(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    db_session.add_all(
        [
            CostModel(
                id=1,
                currency="EUR",
                storage_gb_month_price=1,
                egress_gb_price=1,
                ingress_gb_price=1,
                requests_per_1000_price=1,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            CostEndpointOverride(
                storage_endpoint_id=endpoint.id,
                storage_gb_month_price=0,
                egress_gb_price=0,
                ingress_gb_price=0,
                requests_per_1000_price=7,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=1024**3,
                bytes_out=1024**3,
                ops_total=2000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostStorageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=1024**3,
                total_objects=1,
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            ),
        ]
    )
    db_session.commit()

    cost = CostService(db_session).summary("2026-01", endpoint.id).cost

    assert cost is not None
    assert cost.pricing_source == "endpoint_override"
    assert cost.storage_cost == 0
    assert cost.ingress_cost == 0
    assert cost.egress_cost == 0
    assert cost.requests_cost == 14
    assert cost.total_cost == 14


def test_cost_usage_remains_available_without_configured_model(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    db_session.add(
        CostUsageDaily(
            day=date(2026, 1, 5),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            bytes_in=10,
            bytes_out=20,
            ops_total=30,
            source="rgw_admin_usage",
            collected_at=utcnow(),
        )
    )
    db_session.commit()

    summary = CostService(db_session).summary("2026-01", endpoint.id)

    assert summary.usage.bytes_in == 10
    assert summary.usage.bytes_out == 20
    assert summary.usage.ops_total == 30
    assert summary.cost is None


def test_cost_subject_detail_and_export(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    db_session.add(
        CostUsageDaily(
            day=date(2026, 1, 5),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            bytes_in=0,
            bytes_out=1024,
            ops_total=100,
            source="rgw_admin_usage",
            collected_at=utcnow(),
        )
    )
    db_session.add(
        CostStorageDaily(
            day=date(2026, 1, 5),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            total_bytes=2048,
            total_objects=5,
            source="rgw_admin_bucket_stats",
            collected_at=utcnow(),
        )
    )
    db_session.commit()

    service = CostService(db_session)
    subjects = service.list_subjects("2026-01", endpoint.id, "account", 1, 50, "name", "asc")
    detail = service.subject_detail("2026-01", endpoint.id, "account", account.id)

    assert subjects.items[0].rgw_identifier == account.rgw_user_uid
    assert detail.subject_id == account.id
    assert detail.rgw_identifier == account.rgw_user_uid
    assert detail.usage.bytes_out == 1024
    assert detail.storage.avg_bytes == 2048
    assert detail.coverage.days_collected == 1
    assert detail.coverage.storage_days_collected == 1
    assert detail.coverage.usage_days_collected == 1
    assert len(detail.daily) == 1

    filename, payload = service.export_csv("2026-01", endpoint.id)
    assert filename.startswith("cost-2026-01")
    assert "subject_type" in payload
    assert str(account.id) in payload
    assert account.rgw_user_uid in payload


def test_admin_cost_subject_detail_includes_scoped_twelve_month_history(db_session, monkeypatch):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    other_account = S3Account(
        name="other-account",
        rgw_account_id="RGW99999999999999999",
        rgw_user_uid="other-account-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(other_account)
    db_session.flush()
    db_session.add_all(
        [
            CostModel(
                id=1,
                currency="EUR",
                storage_gb_month_price=0,
                egress_gb_price=0,
                ingress_gb_price=0,
                requests_per_1000_price=1,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 6, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=0,
                bytes_out=0,
                ops_total=1000,
                ops_breakdown='{"get":700,"put":300}',
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 7, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=0,
                bytes_out=0,
                ops_total=2000,
                ops_breakdown='{"get":1500,"put":500}',
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 7, 10),
                storage_endpoint_id=endpoint.id,
                s3_account_id=other_account.id,
                bytes_in=0,
                bytes_out=0,
                ops_total=999000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
        ]
    )
    db_session.commit()
    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: _enabled_cost_settings())

    detail = AdminCostService(db_session).subject_detail("2026-07", endpoint.id, "account", account.id)

    assert len(detail.history) == 12
    assert detail.history[0].month == "2025-08"
    assert detail.history[-1].month == "2026-07"
    assert detail.history[-2].cost is not None
    assert detail.history[-2].cost.total_cost == pytest.approx(1)
    assert detail.history[-1].cost is not None
    assert detail.history[-1].cost.total_cost == pytest.approx(2)
    assert detail.usage.ops_breakdown == {"get": 1500, "put": 500}


def test_cost_subject_detail_types_missing_subject_separately_from_invalid_input(db_session):
    endpoint = _seed_endpoint(db_session)
    service = CostService(db_session)

    with pytest.raises(CostSubjectNotFoundError, match="Subject not found"):
        service.subject_detail("2026-01", endpoint.id, "account", 999)

    with pytest.raises(ValueError, match="Invalid subject type"):
        service.subject_detail("2026-01", endpoint.id, "invalid", 999)

    with pytest.raises(ValueError, match="Invalid month format"):
        service.subject_detail("invalid", endpoint.id, "account", 999)


@pytest.mark.parametrize(
    ("subject_type", "subject_id", "month", "expected_status"),
    [
        ("account", 999, "2026-01", 404),
        ("invalid", 999, "2026-01", 400),
        ("account", 999, "invalid", 400),
    ],
)
def test_admin_cost_subject_detail_distinguishes_missing_from_invalid_input(
    client,
    db_session,
    monkeypatch,
    subject_type,
    subject_id,
    month,
    expected_status,
):
    endpoint = _seed_endpoint(db_session)
    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: _enabled_cost_settings())

    response = client.get(
        f"/api/admin/cost/subject/{subject_type}/{subject_id}",
        params={"month": month, "endpoint_id": endpoint.id},
    )

    assert response.status_code == expected_status, response.text


def test_admin_cost_service_rejects_missing_and_non_ceph_endpoints(db_session, monkeypatch):
    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: _enabled_cost_settings())
    service = AdminCostService(db_session)

    with pytest.raises(ValueError, match="Endpoint not found"):
        service.summary("2026-01", 999)

    endpoint = StorageEndpoint(
        name="s3-generic",
        endpoint_url="https://s3.example.test",
        provider="aws",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()

    with pytest.raises(ValueError, match="not a Ceph endpoint"):
        service.summary("2026-01", endpoint.id)


def test_admin_cost_routes_preserve_feature_and_endpoint_status_codes(client, db_session, monkeypatch):
    disabled = AppSettings()
    disabled.general.cost_enabled = False
    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: disabled)

    response = client.get("/api/admin/cost/summary", params={"month": "2026-01"})
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Cost is disabled"

    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: _enabled_cost_settings())
    response = client.get(
        "/api/admin/cost/summary",
        params={"month": "2026-01", "endpoint_id": 999},
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Endpoint not found"

    endpoint = StorageEndpoint(
        name="aws-cost",
        endpoint_url="https://s3.amazonaws.com",
        provider="aws",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()

    response = client.get(
        "/api/admin/cost/summary",
        params={"month": "2026-01", "endpoint_id": endpoint.id},
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This endpoint is not a Ceph endpoint"


def test_admin_cost_openapi_uses_canonical_subject_type_query_parameter():
    paths = app.openapi()["paths"]

    for path in (
        "/api/admin/cost/subjects",
        "/api/admin/cost/analytics",
        "/api/admin/cost/export.csv",
    ):
        parameter_names = {
            parameter["name"]
            for parameter in paths[path]["get"]["parameters"]
            if parameter["in"] == "query"
        }
        assert "subject_type" in parameter_names
        assert "type" not in parameter_names


def test_cost_coverage_tracks_storage_and_usage_days_separately(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    db_session.add_all(
        [
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=100,
                bytes_out=200,
                ops_total=10,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 1, 6),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=300,
                bytes_out=400,
                ops_total=20,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostStorageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=2048,
                total_objects=5,
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            ),
        ]
    )
    db_session.commit()

    service = CostService(db_session)

    summary = service.summary("2026-01", endpoint.id)
    assert summary.coverage.days_collected == 2
    assert summary.coverage.storage_days_collected == 1
    assert summary.coverage.usage_days_collected == 2

    detail = service.subject_detail("2026-01", endpoint.id, "account", account.id)
    assert detail.coverage.days_collected == 2
    assert detail.coverage.storage_days_collected == 1
    assert detail.coverage.usage_days_collected == 2


def test_cost_subjects_merge_endpoints_and_types_with_global_search_pagination_and_csv(db_session):
    endpoint_a = _seed_endpoint(db_session)
    endpoint_b = StorageEndpoint(
        name="ceph-secondary",
        endpoint_url="http://rgw-secondary.local",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint_b)
    db_session.commit()

    account_a = _seed_account(db_session, endpoint_a.id)
    user_a = _seed_s3_user(db_session, endpoint_a.id)
    account_b = S3Account(
        name="zeta-account",
        rgw_account_id="RGW22222222222222222",
        rgw_user_uid="secondary-account-admin",
        storage_endpoint_id=endpoint_b.id,
    )
    user_b = S3User(
        name="alpha-user",
        rgw_user_uid="secondary-user",
        rgw_access_key="SECONDARY-AK",
        rgw_secret_key="SECONDARY-SK",
        storage_endpoint_id=endpoint_b.id,
        allow_cost_estimation=True,
    )
    db_session.add_all([account_b, user_b])
    db_session.flush()
    db_session.add_all(
        [
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint_b.id,
                s3_account_id=account_b.id,
                bytes_in=200,
                bytes_out=0,
                ops_total=0,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint_b.id,
                s3_user_id=user_b.id,
                bytes_in=300,
                bytes_out=0,
                ops_total=0,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
        ]
    )
    db_session.commit()

    service = CostService(db_session)

    merged = service.list_subjects("2026-01", None, "all", 1, 10, "name", "asc")
    assert merged.total == 4
    assert [item.name for item in merged.items] == ["acme", "alpha-user", "cost-user", "zeta-account"]
    assert {
        (item.storage_endpoint_id, item.storage_endpoint_name, item.subject_type)
        for item in merged.items
    } == {
        (endpoint_a.id, endpoint_a.name, "account"),
        (endpoint_a.id, endpoint_a.name, "s3_user"),
        (endpoint_b.id, endpoint_b.name, "account"),
        (endpoint_b.id, endpoint_b.name, "s3_user"),
    }

    second_page = service.list_subjects("2026-01", None, "all", 2, 2, "name", "asc")
    assert second_page.total == 4
    assert [item.name for item in second_page.items] == ["cost-user", "zeta-account"]
    assert second_page.has_next is False

    endpoint_search = service.list_subjects(
        "2026-01",
        None,
        "all",
        1,
        10,
        "name",
        "asc",
        "SECONDARY",
    )
    assert {item.name for item in endpoint_search.items} == {"alpha-user", "zeta-account"}

    identifier_search = service.list_subjects(
        "2026-01",
        None,
        "all",
        1,
        10,
        "name",
        "asc",
        account_a.rgw_user_uid,
    )
    assert [item.name for item in identifier_search.items] == [account_a.name]

    users_only = service.list_subjects("2026-01", None, "s3_user", 1, 10, "endpoint", "asc")
    assert users_only.total == 2
    assert {item.subject_id for item in users_only.items} == {user_a.id, user_b.id}

    ingress_desc = service.list_subjects("2026-01", None, "all", 1, 10, "ingress", "desc")
    assert [item.name for item in ingress_desc.items[:2]] == [user_b.name, account_b.name]

    filename, payload = service.export_csv("2026-01", None, "all")
    assert filename == "cost-2026-01-all-endpoints.csv"
    assert "storage_endpoint_id,storage_endpoint_name,subject_type" in payload
    assert endpoint_a.name in payload
    assert endpoint_b.name in payload
    assert account_b.name in payload
    assert user_b.name in payload


def test_cost_analytics_reconciles_endpoints_pricing_top_ten_and_history(db_session):
    endpoint_a = _seed_endpoint(db_session)
    endpoint_b = StorageEndpoint(
        name="ceph-secondary",
        endpoint_url="http://rgw-secondary.local",
        provider="ceph",
        is_default=False,
    )
    non_ceph_endpoint = StorageEndpoint(
        name="aws-ignored",
        endpoint_url="https://s3.example.test",
        provider="aws",
        is_default=False,
    )
    db_session.add_all([endpoint_b, non_ceph_endpoint])
    db_session.commit()

    account = _seed_account(db_session, endpoint_a.id)
    non_ceph_user = S3User(
        name="ignored-user",
        rgw_user_uid="ignored-user",
        rgw_access_key="IGNORED-AK",
        rgw_secret_key="IGNORED-SK",
        storage_endpoint_id=non_ceph_endpoint.id,
        allow_cost_estimation=True,
    )
    db_session.add(non_ceph_user)
    users = []
    for index in range(1, 12):
        user = S3User(
            name=f"user-{index:02d}",
            rgw_user_uid=f"secondary-user-{index:02d}",
            rgw_access_key=f"SECONDARY-AK-{index:02d}",
            rgw_secret_key=f"SECONDARY-SK-{index:02d}",
            storage_endpoint_id=endpoint_b.id,
            allow_cost_estimation=True,
        )
        db_session.add(user)
        users.append(user)
    db_session.flush()

    db_session.add_all(
        [
            CostModel(
                id=1,
                currency="EUR",
                storage_gb_month_price=0,
                egress_gb_price=0,
                ingress_gb_price=0,
                requests_per_1000_price=1,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            CostEndpointOverride(
                storage_endpoint_id=endpoint_b.id,
                storage_gb_month_price=0,
                egress_gb_price=0,
                ingress_gb_price=0,
                requests_per_1000_price=2,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint_a.id,
                s3_account_id=account.id,
                bytes_in=0,
                bytes_out=0,
                ops_total=1000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=non_ceph_endpoint.id,
                s3_user_id=non_ceph_user.id,
                bytes_in=0,
                bytes_out=0,
                ops_total=999000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
        ]
    )
    for index, user in enumerate(users, start=1):
        db_session.add(
            CostUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint_b.id,
                s3_user_id=user.id,
                bytes_in=0,
                bytes_out=0,
                ops_total=index * 1000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            )
        )
    db_session.commit()

    service = CostService(db_session)
    result = service.analytics("2026-01", None, "all")

    assert result.summary.cost is not None
    assert result.summary.cost.total_cost == pytest.approx(133)
    assert result.summary.cost.pricing_source == "mixed"
    assert result.summary.coverage.days_collected == 1

    assert [entry.storage_endpoint_id for entry in result.by_endpoint] == [endpoint_b.id, endpoint_a.id]
    assert [entry.cost.total_cost for entry in result.by_endpoint if entry.cost] == pytest.approx([132, 1])
    assert sum(entry.cost.total_cost for entry in result.by_endpoint if entry.cost) == pytest.approx(
        result.summary.cost.total_cost
    )

    assert len(result.top_subjects) == 10
    assert result.top_subjects[0].name == "user-11"
    assert result.top_subjects[-1].name == "user-02"
    assert result.concentration.top_five_cost == pytest.approx(90)
    assert result.concentration.other_cost == pytest.approx(43)
    assert result.concentration.top_five_ratio == pytest.approx(90 / 133)

    assert len(result.history) == 12
    assert result.history[0].month == "2025-02"
    assert result.history[-1].month == "2026-01"

    accounts_only = service.analytics("2026-01", None, "account")
    assert accounts_only.subject_type == "account"
    assert accounts_only.summary.usage.ops_total == 1000
    assert accounts_only.summary.cost is not None
    assert accounts_only.summary.cost.total_cost == pytest.approx(1)
    assert [entry.storage_endpoint_id for entry in accounts_only.by_endpoint] == [endpoint_a.id]
    assert [entry.name for entry in accounts_only.top_subjects] == [account.name]

    no_data = service.analytics("2026-02", None, "all")
    assert no_data.summary.coverage.days_collected == 0
    assert no_data.by_endpoint == []
    assert no_data.top_subjects == []
