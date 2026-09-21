# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import sessionmaker

from app.db import EndpointHealthLatest, StorageEndpoint, User, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.routers.admin import settings as admin_settings
from app.routers.admin import storage_endpoints as admin_endpoints
from app.routers.internal import billing_collect, healthchecks
from app.services import healthcheck_background_service as background
from app.services import healthcheck_service
from app.services.billing_collection_service import BillingCollector
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import HEALTHCHECK_RUN_OPERATION, OperationLeaseService


@pytest.fixture
def scheduled_settings(db_session, test_engine, monkeypatch):
    settings = AppSettings()
    factory = sessionmaker(bind=test_engine, autocommit=False, autoflush=False)
    monkeypatch.setattr(background, "SessionLocal", factory)
    for module in (background, healthcheck_service, healthchecks, billing_collect):
        monkeypatch.setattr(module, "load_app_settings", lambda: settings)
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    return settings


def _seed_endpoint(db_session, name="probe") -> int:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="other",
        is_default=False,
        is_editable=True,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint.id


def _forbid_call(*args, **kwargs):
    raise AssertionError("This operation must not run")


def _allow_superadmin():
    app.dependency_overrides[dependencies.get_current_ui_superadmin] = lambda: User(
        id=999, email="admin@example.test", hashed_password="x",
        is_active=True, role=UserRole.UI_SUPERADMIN.value,
    )


@pytest.mark.parametrize(
    "path,feature,operation,service,method",
    [
        ("/api/internal/healthchecks/run", "endpoint_status_enabled", HEALTHCHECK_RUN_OPERATION, HealthCheckService, "run_checks"),
        ("/api/internal/billing/collect/daily?day=2026-09-21", "billing_enabled", "billing:daily:2026-09-21", BillingCollector, "collect_daily"),
    ],
)
def test_disabled_scheduled_features_skip_without_work(
    client, db_session, monkeypatch, scheduled_settings, path, feature, operation, service, method,
):
    setattr(scheduled_settings.general, feature, False)
    monkeypatch.setattr(service, method, _forbid_call)
    monkeypatch.setattr(OperationLeaseService, "acquire", _forbid_call)

    response = client.post(path, headers={"X-Internal-Token": "expected-token"})

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "skipped", "reason": "feature_disabled", "operation": operation}
    assert db_session.query(EndpointHealthLatest).count() == 0


@pytest.mark.parametrize("enabled", [False, True])
def test_scheduled_healthcheck_requires_token_even_when_disabled(client, scheduled_settings, enabled):
    scheduled_settings.general.endpoint_status_enabled = enabled
    response = client.post("/api/internal/healthchecks/run", headers={"X-Internal-Token": "wrong-token"})
    assert response.status_code == 401


def test_scheduled_healthcheck_persists_status(client, db_session, monkeypatch, scheduled_settings):
    endpoint_id = _seed_endpoint(db_session)
    monkeypatch.setattr(healthcheck_service.requests, "get", lambda *args, **kwargs: SimpleNamespace(status_code=200))

    response = client.post("/api/internal/healthchecks/run", headers={"X-Internal-Token": "expected-token"})

    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    latest = db_session.query(EndpointHealthLatest).filter_by(storage_endpoint_id=endpoint_id).one()
    assert latest.status == "up"
    assert latest.checked_at is not None
    assert OperationLeaseService(db_session).current_owner(HEALTHCHECK_RUN_OPERATION) is None


def test_real_scheduled_failure_remains_an_error_and_releases_lease(
    client, db_session, monkeypatch, scheduled_settings,
):
    def fail(self):
        raise ValueError("Invalid probe configuration")

    monkeypatch.setattr(HealthCheckService, "run_checks", fail)
    response = client.post("/api/internal/healthchecks/run", headers={"X-Internal-Token": "expected-token"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid probe configuration"
    assert OperationLeaseService(db_session).current_owner(HEALTHCHECK_RUN_OPERATION) is None


def test_initial_check_only_probes_the_created_endpoint(db_session, monkeypatch, scheduled_settings):
    endpoint_id = _seed_endpoint(db_session)
    _seed_endpoint(db_session, "unrelated")
    urls = []

    def probe(url, **kwargs):
        urls.append(url)
        return SimpleNamespace(status_code=200)

    monkeypatch.setattr(healthcheck_service.requests, "get", probe)
    background.run_initial_healthchecks(endpoint_id=endpoint_id)

    assert urls == ["https://probe.example.test"]
    latest = db_session.query(EndpointHealthLatest).one()
    assert latest.storage_endpoint_id == endpoint_id
    assert latest.status == "up"


def test_initial_check_rechecks_feature_before_execution(db_session, monkeypatch, scheduled_settings):
    scheduled_settings.general.endpoint_status_enabled = False
    acquire = Mock(side_effect=_forbid_call)
    run = Mock(side_effect=_forbid_call)
    monkeypatch.setattr(OperationLeaseService, "acquire", acquire)
    monkeypatch.setattr(HealthCheckService, "run_checks", run)
    background.run_initial_healthchecks()
    acquire.assert_not_called()
    run.assert_not_called()
    assert db_session.query(EndpointHealthLatest).count() == 0


def test_initial_check_respects_the_scheduler_lease(db_session, monkeypatch, scheduled_settings):
    lease = OperationLeaseService(db_session).acquire(HEALTHCHECK_RUN_OPERATION, ttl_seconds=600, owner="cron")
    run = Mock(side_effect=_forbid_call)
    monkeypatch.setattr(HealthCheckService, "run_checks", run)
    background.run_initial_healthchecks()
    run.assert_not_called()
    assert OperationLeaseService(db_session).current_owner(HEALTHCHECK_RUN_OPERATION) == lease.owner


def test_initial_failure_is_logged_and_does_not_retain_the_lease(
    db_session, monkeypatch, scheduled_settings, caplog,
):
    def fail(self, **kwargs):
        raise RuntimeError("Probe unavailable")

    monkeypatch.setattr(HealthCheckService, "run_checks", fail)
    background.run_initial_healthchecks()
    assert "Initial endpoint healthcheck failed" in caplog.text
    assert OperationLeaseService(db_session).current_owner(HEALTHCHECK_RUN_OPERATION) is None


def test_endpoint_creation_runs_initial_check_after_persisting(client, db_session, monkeypatch, scheduled_settings):
    _allow_superadmin()
    monkeypatch.setattr(admin_endpoints, "run_initial_healthchecks", background.run_initial_healthchecks)
    monkeypatch.setattr(healthcheck_service.requests, "get", lambda *args, **kwargs: SimpleNamespace(status_code=200))

    response = client.post("/api/admin/storage-endpoints", json={
        "name": "created", "endpoint_url": "https://created.example.test", "provider": "other",
    })

    assert response.status_code == 201, response.text
    latest = db_session.query(EndpointHealthLatest).one()
    assert latest.storage_endpoint_id == response.json()["id"]
    assert latest.status == "up"


def test_initial_failure_keeps_endpoint_creation_successful(
    client, db_session, monkeypatch, scheduled_settings, caplog,
):
    _allow_superadmin()
    monkeypatch.setattr(admin_endpoints, "run_initial_healthchecks", background.run_initial_healthchecks)
    monkeypatch.setattr(HealthCheckService, "run_checks", Mock(side_effect=RuntimeError("Probe failed")))

    response = client.post("/api/admin/storage-endpoints", json={
        "name": "created", "endpoint_url": "https://created.example.test", "provider": "other",
    })

    assert response.status_code == 201, response.text
    assert db_session.query(StorageEndpoint).filter_by(id=response.json()["id"]).count() == 1
    assert "Initial endpoint healthcheck failed" in caplog.text
    assert OperationLeaseService(db_session).current_owner(HEALTHCHECK_RUN_OPERATION) is None


@pytest.mark.parametrize("before,after,expected_runs", [(False, True, 1), (True, True, 0), (True, False, 0), (False, False, 0)])
def test_settings_only_trigger_initial_check_on_effective_activation(
    client, monkeypatch, scheduled_settings, before, after, expected_runs,
):
    _allow_superadmin()
    current = AppSettings()
    current.general.endpoint_status_enabled = before
    saved = AppSettings()
    saved.general.endpoint_status_enabled = after
    monkeypatch.setattr(admin_settings, "load_app_settings_for_db", lambda db: current)
    monkeypatch.setattr(admin_settings, "save_app_settings", lambda payload: saved)
    monkeypatch.setattr(admin_settings, "get_portal_service", lambda db: SimpleNamespace(
        reconcile_all_portal_server_access_logging=lambda settings: {},
    ))
    runs = []
    monkeypatch.setattr(admin_settings, "run_initial_healthchecks", lambda: runs.append(True))

    response = client.put("/api/admin/settings", json=saved.model_dump(mode="json"))

    assert response.status_code == 200, response.text
    assert len(runs) == expected_runs


def test_environment_lock_prevents_initial_check_on_requested_activation(client, monkeypatch, scheduled_settings):
    _allow_superadmin()
    locked = AppSettings()
    locked.general.endpoint_status_enabled = False
    requested = AppSettings()
    requested.general.endpoint_status_enabled = True
    monkeypatch.setattr(admin_settings, "load_app_settings_for_db", lambda db: locked)
    monkeypatch.setattr(admin_settings, "save_app_settings", lambda payload: locked)
    monkeypatch.setattr(admin_settings, "get_portal_service", lambda db: SimpleNamespace(
        reconcile_all_portal_server_access_logging=lambda settings: {},
    ))
    monkeypatch.setattr(admin_settings, "run_initial_healthchecks", _forbid_call)

    response = client.put("/api/admin/settings", json=requested.model_dump(mode="json"))

    assert response.status_code == 200, response.text
    assert response.json()["general"]["endpoint_status_enabled"] is False
