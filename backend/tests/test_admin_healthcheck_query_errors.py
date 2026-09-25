# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.models.app_settings import AppSettings
from app.routers.admin import healthchecks as healthchecks_router
from app.services.healthcheck_query_service import HealthCheckQueryService


def _enabled_settings() -> AppSettings:
    settings = AppSettings()
    settings.general.endpoint_status_enabled = True
    return settings


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/health/series?endpoint_id=999",
        "/api/admin/health/incidents?endpoint_id=999",
        "/api/admin/health/raw-checks?endpoint_id=999",
        "/api/admin/health/workspace-overview?endpoint_id=999",
    ],
)
def test_health_query_routes_map_missing_endpoint_to_not_found(client, monkeypatch, path):
    monkeypatch.setattr(healthchecks_router, "load_app_settings", _enabled_settings)

    response = client.get(path)

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Endpoint not found."


@pytest.mark.parametrize(
    ("method_name", "path"),
    [
        ("build_series", "/api/admin/health/series?endpoint_id=999"),
        ("build_incidents", "/api/admin/health/incidents?endpoint_id=999"),
        ("build_raw_checks", "/api/admin/health/raw-checks?endpoint_id=999"),
        ("build_workspace_health_overview", "/api/admin/health/workspace-overview?endpoint_id=999"),
    ],
)
def test_health_query_routes_keep_other_value_errors_as_bad_request(
    client,
    monkeypatch,
    method_name,
    path,
):
    monkeypatch.setattr(healthchecks_router, "load_app_settings", _enabled_settings)

    def raise_invalid_request(*args, **kwargs):
        raise ValueError("Invalid health query")

    monkeypatch.setattr(HealthCheckQueryService, method_name, raise_invalid_request)

    response = client.get(path)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Invalid health query"
