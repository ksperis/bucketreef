# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.app_settings import AppSettings
from app.routers.admin import healthchecks as healthchecks_router
from app.routers.admin import usage_history as usage_history_router
from app.services import admin_cost_service
from app.services.cost_collection_service import CostCollector
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import (
    HEALTHCHECK_RUN_OPERATION,
    USAGE_HISTORY_COLLECT_OPERATION,
    OperationLeaseService,
    cost_daily_operation_name,
)
from app.services.quota_monitoring_service import QuotaMonitoringService


def _fail_if_called(*args, **kwargs):
    raise AssertionError("collection should not run while a lease is active")


def _enabled_settings() -> AppSettings:
    settings = AppSettings()
    settings.general.cost_enabled = True
    settings.general.endpoint_status_enabled = True
    settings.general.usage_history_enabled = True
    return settings


def test_admin_cost_collect_returns_conflict_when_lease_is_active(client, db_session, monkeypatch):
    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: _enabled_settings())
    OperationLeaseService(db_session).acquire(
        cost_daily_operation_name("2026-07-03"),
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(CostCollector, "collect_daily", _fail_if_called)

    response = client.post("/api/admin/cost/collect/daily?day=2026-07-03")

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "A cost collection is already running for this day."


def test_admin_cost_collect_rejects_invalid_day(client, monkeypatch):
    monkeypatch.setattr(admin_cost_service, "load_app_settings_for_db_readonly", lambda _db: _enabled_settings())

    response = client.post("/api/admin/cost/collect/daily?day=2026-02-30")

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid day format, expected YYYY-MM-DD"


def test_admin_healthchecks_return_conflict_when_lease_is_active(client, db_session, monkeypatch):
    monkeypatch.setattr(
        healthchecks_router,
        "load_app_settings_for_db_readonly",
        lambda _db: _enabled_settings(),
    )
    OperationLeaseService(db_session).acquire(
        HEALTHCHECK_RUN_OPERATION,
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(HealthCheckService, "run_checks", _fail_if_called)

    response = client.post("/api/admin/health/run")

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Endpoint health checks are already running."


def test_admin_usage_history_returns_conflict_when_lease_is_active(client, db_session, monkeypatch):
    monkeypatch.setattr(
        usage_history_router,
        "load_app_settings_for_db_readonly",
        lambda _db: _enabled_settings(),
    )
    OperationLeaseService(db_session).acquire(
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=600,
        owner="other-backend",
    )
    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", _fail_if_called)

    response = client.post("/api/admin/usage-history/collect")

    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "Usage history collection is already running."
