# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.utils.time import utcnow
from datetime import date, datetime, timedelta
from decimal import Decimal
import json
from types import SimpleNamespace

import pytest

from app.core.domain_errors import BillingSubjectNotFoundError
from app.db import (
    BillingAssignment,
    BillingRateCard,
    BillingRatePlan,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    StorageEndpoint,
)
from app.models.app_settings import AppSettings
from app.services import admin_billing_service
from app.services.admin_billing_service import AdminBillingService
from app.services.billing_collection_service import BillingCollector
from app.services.billing_service import (
    BillingService,
    _parse_month,
    _parse_ops_breakdown,
    _resolve_rate_card,
)
from app.utils.quota_stats import QuotaSnapshot


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


def _enabled_billing_settings() -> AppSettings:
    settings = AppSettings()
    settings.general.billing_enabled = True
    return settings


def test_parse_month():
    period = _parse_month("2026-01")
    assert period.start == date(2026, 1, 1)
    assert period.end == date(2026, 2, 1)
    assert period.days_in_month == 31


def test_billing_collection_returns_structured_errors_without_exception_detail(db_session, monkeypatch):
    endpoint = StorageEndpoint(
        name="billing-error-endpoint",
        endpoint_url="https://billing-error.example.test",
        provider="ceph",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    db_session.refresh(endpoint)

    class GeneralSettings:
        billing_enabled = True

    class AppSettings:
        general = GeneralSettings()

    monkeypatch.setattr("app.services.app_settings_service.load_app_settings", lambda: AppSettings())
    monkeypatch.setattr(
        "app.services.billing_collection_service.get_supervision_rgw_client",
        lambda _endpoint: (_ for _ in ()).throw(RuntimeError("secret upstream detail")),
    )
    monkeypatch.setattr(
        "app.services.billing_collection_service.DataRetentionService.purge_all",
        lambda _self: {},
    )

    result = BillingCollector(db_session).collect_daily(date(2026, 9, 25))

    assert result["errors"] == [{"stage": "endpoint", "endpoint_id": endpoint.id}]
    assert "secret upstream detail" not in repr(result)


def test_billing_ops_breakdown_requires_integer_values():
    assert _parse_ops_breakdown('{"get":12,"put":3}') == {
        "get": 12,
        "put": 3,
    }
    for raw in ("{", "[]", '{"get":"12"}', '{"get":true}'):
        with pytest.raises(ValueError):
            _parse_ops_breakdown(raw)


def test_billing_summary_and_cost(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    day_one = date(2026, 1, 10)
    day_two = date(2026, 1, 11)

    db_session.add_all(
        [
            BillingUsageDaily(
                day=day_one,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=1024,
                bytes_out=2048,
                ops_total=1000,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            BillingUsageDaily(
                day=day_two,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=2048,
                bytes_out=4096,
                ops_total=500,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            BillingStorageDaily(
                day=day_one,
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=100,
                total_objects=10,
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            ),
            BillingStorageDaily(
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

    rate_plan = BillingRatePlan(
        name="default",
        storage_endpoint_id=endpoint.id,
    )
    rate_card = BillingRateCard(
        rate_plan=rate_plan,
        currency="EUR",
        storage_gb_month_price=1.0,
        egress_gb_price=2.0,
        ingress_gb_price=0.5,
        requests_per_1000_price=3.0,
        effective_from=date(2025, 1, 1),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(rate_card)
    db_session.commit()

    service = BillingService(db_session)
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
    assert summary.cost.total_cost is not None
    assert summary.cost.total_cost > 0
    assert summary.rate_resolution.status == "resolved"
    assert summary.rate_resolution.layer == "endpoint"
    assert summary.rate_resolution.rate_plan_id == rate_plan.id
    assert summary.rate_resolution.rate_card_id == rate_card.id
    assert summary.rate_resolution.currency == "EUR"
    assert summary.rate_resolution.storage_charge_basis == "actual_usage"


def test_allocated_quota_billing_uses_historical_daily_quota_and_serializes_decimals(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    gib = 1024**3
    start = date(2026, 1, 1)
    for offset in range(31):
        quota_gib = 100 if offset < 15 else 200
        db_session.add(
            BillingStorageDaily(
                day=start + timedelta(days=offset),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=0,
                total_objects=0,
                quota_size_bytes=quota_gib * gib,
                quota_state="valid",
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            )
        )
    plan = BillingRatePlan(name="default", storage_endpoint_id=endpoint.id)
    db_session.add(
        BillingRateCard(
            rate_plan=plan,
            currency="EUR",
            storage_charge_basis="allocated_quota",
            storage_gb_month_price=Decimal("0.020000"),
            effective_from=start,
        )
    )
    db_session.commit()

    summary = BillingService(db_session).summary("2026-01", endpoint.id)

    assert summary.cost is not None
    assert summary.cost.complete is True
    assert summary.cost.storage_cost == Decimal("3.032258")
    assert summary.cost.total_cost == Decimal("3.032258")
    assert summary.cost.storage_quantity is not None
    assert summary.cost.storage_quantity.basis == "allocated_quota"
    assert summary.cost.storage_quantity.quantity_gib_month == Decimal("151.612903225806")
    assert summary.cost.storage_quantity.coverage_ratio == Decimal("1.000000")
    assert summary.cost.storage_quantity.status == "complete"

    serialized = json.loads(summary.model_dump_json())
    assert serialized["cost"]["storage_cost"] == "3.032258"
    assert serialized["cost"]["total_cost"] == "3.032258"
    assert serialized["cost"]["storage_quantity"]["quantity_gib_month"] == "151.612903225806"


def test_allocated_quota_missing_or_unlimited_history_is_explicitly_blocking(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    gib = 1024**3
    start = date(2026, 1, 1)
    for offset in range(30):
        db_session.add(
            BillingStorageDaily(
                day=start + timedelta(days=offset),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                total_bytes=0,
                total_objects=0,
                quota_size_bytes=100 * gib,
                quota_state="valid",
                source="rgw_admin_bucket_stats",
                collected_at=utcnow(),
            )
        )
    db_session.add(
        BillingStorageDaily(
            day=start + timedelta(days=30),
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            total_bytes=0,
            total_objects=0,
            quota_size_bytes=None,
            quota_state="unlimited",
            source="rgw_admin_bucket_stats",
            collected_at=utcnow(),
        )
    )
    plan = BillingRatePlan(name="default", storage_endpoint_id=endpoint.id)
    db_session.add(
        BillingRateCard(
            rate_plan=plan,
            currency="EUR",
            storage_charge_basis="allocated_quota",
            storage_gb_month_price=Decimal("1.000000"),
            effective_from=start,
        )
    )
    db_session.commit()

    summary = BillingService(db_session).summary("2026-01", endpoint.id)

    assert summary.cost is not None
    assert summary.cost.complete is False
    assert summary.cost.storage_quantity is not None
    assert summary.cost.storage_quantity.status == "blocked"
    assert summary.cost.storage_quantity.observations_collected == 30
    assert summary.cost.storage_quantity.observations_expected == 31
    assert summary.cost.storage_quantity.coverage_ratio == Decimal("0.967742")
    assert summary.cost.storage_quantity.issues == ["unlimited_quota"]
    assert summary.cost.storage_cost == Decimal("96.774194")


def test_billing_storage_collection_persists_quota_snapshot_with_storage_stats(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    gib = 1024**3
    storage_client = SimpleNamespace(
        get_all_buckets=lambda **_kwargs: {
            "buckets": [
                {"bucket": "data", "usage": {"total_bytes": 42, "total_objects": 2}}
            ]
        }
    )
    quota_client = SimpleNamespace(
        get_account_quota_snapshot=lambda _account_id: QuotaSnapshot(200 * gib, None, "valid"),
        get_user_quota_snapshot=lambda _uid, tenant=None: QuotaSnapshot(100 * gib, None, "valid"),
    )

    created, errors = BillingCollector(db_session)._collect_storage_for_endpoint(
        storage_client,
        endpoint,
        date(2026, 1, 15),
        quota_admin=quota_client,
    )

    assert created == 1
    assert errors == []
    row = db_session.query(BillingStorageDaily).filter_by(s3_account_id=account.id).one()
    assert row.total_bytes == 42
    assert row.quota_size_bytes == 200 * gib
    assert row.quota_state == "valid"


def test_daily_billing_collects_quota_without_quota_monitoring_enablement(db_session, monkeypatch):
    endpoint = StorageEndpoint(
        name="billing-quota-independent",
        endpoint_url="https://billing-quota-independent.example.test",
        provider="ceph",
        features_config="features:\n  admin:\n    enabled: true\n",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    account = _seed_account(db_session, endpoint.id)
    gib = 1024**3

    class GeneralSettings:
        billing_enabled = True

    class AppSettings:
        general = GeneralSettings()

    supervision = SimpleNamespace(
        get_usage=lambda **_kwargs: {},
        get_all_buckets=lambda **_kwargs: {"buckets": []},
    )
    runtime = SimpleNamespace(
        get_account_quota_snapshot=lambda _account_id: QuotaSnapshot(250 * gib, None, "valid"),
        get_user_quota_snapshot=lambda _uid, tenant=None: QuotaSnapshot(None, None, "missing"),
    )
    monkeypatch.setattr("app.services.app_settings_service.load_app_settings", lambda: AppSettings())
    monkeypatch.setattr(
        "app.services.billing_collection_service.get_supervision_rgw_client",
        lambda _endpoint: supervision,
    )
    monkeypatch.setattr(
        "app.services.billing_collection_service.get_endpoint_runtime_rgw_client",
        lambda _endpoint: runtime,
    )
    monkeypatch.setattr(
        "app.services.billing_collection_service.DataRetentionService.purge_all",
        lambda _self: {},
    )

    result = BillingCollector(db_session).collect_daily(date(2026, 1, 16))

    assert result["errors"] == []
    row = db_session.query(BillingStorageDaily).filter_by(s3_account_id=account.id).one()
    assert row.quota_size_bytes == 250 * gib
    assert row.quota_state == "valid"


def test_rate_resolution_uses_assignment_windows_and_effective_plan_versions(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    other = S3Account(
        name="other",
        rgw_account_id="RGW22345678901234567",
        rgw_user_uid="rgw22345678901234567-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(other)

    direct_plan = BillingRatePlan(name="direct", storage_endpoint_id=endpoint.id)
    endpoint_plan = BillingRatePlan(name="default", storage_endpoint_id=endpoint.id)
    global_plan = BillingRatePlan(name="default", storage_endpoint_id=None)
    db_session.add_all([direct_plan, endpoint_plan, global_plan])
    db_session.flush()

    direct_jan = BillingRateCard(
        rate_plan_id=direct_plan.id,
        currency="EUR",
        storage_charge_basis="actual_usage",
        storage_gb_month_price=1,
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 1, 31),
    )
    direct_feb = BillingRateCard(
        rate_plan_id=direct_plan.id,
        currency="EUR",
        storage_charge_basis="allocated_quota",
        storage_gb_month_price=2,
        effective_from=date(2026, 2, 1),
    )
    endpoint_jan = BillingRateCard(
        rate_plan_id=endpoint_plan.id,
        currency="EUR",
        storage_gb_month_price=3,
        effective_from=date(2026, 1, 1),
    )
    global_jan = BillingRateCard(
        rate_plan_id=global_plan.id,
        currency="EUR",
        storage_gb_month_price=4,
        effective_from=date(2026, 1, 1),
    )
    db_session.add_all([direct_jan, direct_feb, endpoint_jan, global_jan])
    db_session.flush()
    db_session.add(
        BillingAssignment(
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            rate_plan_id=direct_plan.id,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 2, 28),
        )
    )
    db_session.commit()

    january = _resolve_rate_card(
        db_session,
        endpoint.id,
        _parse_month("2026-01"),
        "account",
        account.id,
    )
    february = _resolve_rate_card(
        db_session,
        endpoint.id,
        _parse_month("2026-02"),
        "account",
        account.id,
    )
    fallback = _resolve_rate_card(
        db_session,
        endpoint.id,
        _parse_month("2026-01"),
        "account",
        other.id,
    )

    assert january is not None and january.id == direct_jan.id
    assert january.storage_charge_basis == "actual_usage"
    assert february is not None and february.id == direct_feb.id
    assert february.storage_charge_basis == "allocated_quota"
    assert fallback is not None and fallback.id == endpoint_jan.id


def test_rate_resolution_does_not_use_next_month_version_for_current_month(db_session):
    endpoint = _seed_endpoint(db_session)
    plan = BillingRatePlan(name="default", storage_endpoint_id=endpoint.id)
    db_session.add(plan)
    db_session.flush()
    january = BillingRateCard(
        rate_plan_id=plan.id,
        currency="EUR",
        storage_gb_month_price=1,
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 1, 31),
    )
    february = BillingRateCard(
        rate_plan_id=plan.id,
        currency="EUR",
        storage_gb_month_price=9,
        effective_from=date(2026, 2, 1),
    )
    db_session.add_all([january, february])
    db_session.commit()

    resolved = _resolve_rate_card(db_session, endpoint.id, _parse_month("2026-01"))

    assert resolved is not None
    assert resolved.id == january.id


def test_billing_subject_detail_and_export(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    db_session.add(
        BillingUsageDaily(
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
        BillingStorageDaily(
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

    service = BillingService(db_session)
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
    assert detail.rate_resolution.status == "missing"
    assert detail.rate_resolution.issues == ["no_effective_rate_plan"]

    filename, payload = service.export_csv("2026-01", endpoint.id)
    assert filename.startswith("billing-2026-01")
    assert "subject_type" in payload
    assert "rate_resolution_status" in payload
    assert "rate_source_layer" in payload
    assert "rate_card_effective_from" in payload
    assert "missing" in payload
    assert str(account.id) in payload
    assert account.rgw_user_uid in payload


def test_billing_surfaces_expose_canonical_direct_rate_resolution(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)
    endpoint_plan = BillingRatePlan(name="default", storage_endpoint_id=endpoint.id)
    direct_plan = BillingRatePlan(name="reserved", storage_endpoint_id=endpoint.id)
    endpoint_card = BillingRateCard(
        rate_plan=endpoint_plan,
        currency="EUR",
        storage_charge_basis="actual_usage",
        storage_gb_month_price=Decimal("1.000000"),
        effective_from=date(2026, 1, 1),
    )
    direct_card = BillingRateCard(
        rate_plan=direct_plan,
        currency="EUR",
        storage_charge_basis="allocated_quota",
        storage_gb_month_price=Decimal("2.000000"),
        effective_from=date(2026, 1, 1),
    )
    assignment = BillingAssignment(
        storage_endpoint_id=endpoint.id,
        s3_account_id=account.id,
        rate_plan=direct_plan,
        effective_from=date(2026, 1, 1),
    )
    db_session.add_all([endpoint_card, direct_card, assignment])
    db_session.commit()

    service = BillingService(db_session)
    summary = service.summary("2026-01", endpoint.id)
    subjects = service.list_subjects("2026-01", endpoint.id, "account", 1, 50, "name", "asc")
    detail = service.subject_detail("2026-01", endpoint.id, "account", account.id)
    _filename, payload = service.export_csv("2026-01", endpoint.id)

    assert summary.rate_resolution.status == "resolved"
    assert summary.rate_resolution.layer == "endpoint"
    assert summary.rate_resolution.rate_card_id == endpoint_card.id

    subject = subjects.items[0]
    assert subject.rate_resolution.status == "resolved"
    assert subject.rate_resolution.layer == "direct"
    assert subject.rate_resolution.rate_plan_id == direct_plan.id
    assert subject.rate_resolution.rate_card_id == direct_card.id
    assert subject.rate_resolution.source_assignment_id == assignment.id
    assert subject.rate_resolution.storage_charge_basis == "allocated_quota"

    assert detail.rate_resolution == subject.rate_resolution
    assert f",direct,{direct_plan.id},reserved,{direct_card.id},2026-01-01," in payload


def test_billing_subject_detail_types_missing_subject_separately_from_invalid_input(db_session):
    endpoint = _seed_endpoint(db_session)
    service = BillingService(db_session)

    with pytest.raises(BillingSubjectNotFoundError, match="Subject not found"):
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
def test_admin_billing_subject_detail_distinguishes_missing_from_invalid_input(
    client,
    db_session,
    monkeypatch,
    subject_type,
    subject_id,
    month,
    expected_status,
):
    endpoint = _seed_endpoint(db_session)
    monkeypatch.setattr(admin_billing_service, "load_app_settings", _enabled_billing_settings)

    response = client.get(
        f"/api/admin/billing/subject/{subject_type}/{subject_id}",
        params={"month": month, "endpoint_id": endpoint.id},
    )

    assert response.status_code == expected_status, response.text


def test_admin_billing_service_rejects_missing_and_non_ceph_endpoints(db_session, monkeypatch):
    monkeypatch.setattr(admin_billing_service, "load_app_settings", _enabled_billing_settings)
    service = AdminBillingService(db_session)

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


def test_admin_billing_routes_preserve_feature_and_endpoint_status_codes(client, db_session, monkeypatch):
    disabled = AppSettings()
    disabled.general.billing_enabled = False
    monkeypatch.setattr(admin_billing_service, "load_app_settings", lambda: disabled)

    response = client.get("/api/admin/billing/summary", params={"month": "2026-01"})
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "Billing is disabled"

    monkeypatch.setattr(admin_billing_service, "load_app_settings", _enabled_billing_settings)
    response = client.get(
        "/api/admin/billing/summary",
        params={"month": "2026-01", "endpoint_id": 999},
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Endpoint not found"

    endpoint = StorageEndpoint(
        name="aws-billing",
        endpoint_url="https://s3.amazonaws.com",
        provider="aws",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()

    response = client.get(
        "/api/admin/billing/summary",
        params={"month": "2026-01", "endpoint_id": endpoint.id},
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "This endpoint is not a Ceph endpoint"


def test_billing_coverage_tracks_storage_and_usage_days_separately(db_session):
    endpoint = _seed_endpoint(db_session)
    account = _seed_account(db_session, endpoint.id)

    db_session.add_all(
        [
            BillingUsageDaily(
                day=date(2026, 1, 5),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=100,
                bytes_out=200,
                ops_total=10,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            BillingUsageDaily(
                day=date(2026, 1, 6),
                storage_endpoint_id=endpoint.id,
                s3_account_id=account.id,
                bytes_in=300,
                bytes_out=400,
                ops_total=20,
                source="rgw_admin_usage",
                collected_at=utcnow(),
            ),
            BillingStorageDaily(
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

    service = BillingService(db_session)

    summary = service.summary("2026-01", endpoint.id)
    assert summary.coverage.days_collected == 2
    assert summary.coverage.storage_days_collected == 1
    assert summary.coverage.usage_days_collected == 2

    detail = service.subject_detail("2026-01", endpoint.id, "account", account.id)
    assert detail.coverage.days_collected == 2
    assert detail.coverage.storage_days_collected == 1
    assert detail.coverage.usage_days_collected == 2
