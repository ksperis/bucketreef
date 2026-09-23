# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.models.app_settings import AppSettings
from app.routers.admin import production_readiness as production_readiness_router


def _settings(**overrides) -> Settings:
    values = {
        "deployment_profile": "full",
        "jwt_keys": ["legacy-jwt-key-that-is-at-least-32-bytes"],
        "ui_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "api_jwt_keys": ["api-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "credential_keys": ["credential-key-that-is-at-least-32-bytes"],
        "internal_cron_token": "internal-cron-token-that-is-at-least-32-bytes",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _client(settings: Settings, db, *, authorized: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(production_readiness_router.router, prefix="/api")
    app.dependency_overrides[production_readiness_router.get_settings] = lambda: settings
    app.dependency_overrides[production_readiness_router.get_db] = lambda: db
    if authorized:
        app.dependency_overrides[production_readiness_router.get_current_ui_superadmin] = lambda: object()
    else:

        def deny():
            raise HTTPException(status_code=403, detail="Forbidden")

        app.dependency_overrides[production_readiness_router.get_current_ui_superadmin] = deny
    return TestClient(app)


def test_production_readiness_returns_grouped_runtime_summary_without_secrets(monkeypatch, db_session):
    settings = _settings(deployment_profile="full", app_env="development")
    app_settings = AppSettings()
    app_settings.general.require_passkey_for_admins = True
    monkeypatch.setattr(
        production_readiness_router,
        "load_app_settings_for_db",
        lambda _db: app_settings,
    )

    response = _client(settings, db_session).get("/api/admin/production-readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["environment"] == "development"
    assert payload["profile"] == "full"
    assert payload["status"] in {"blocked", "critical", "warning", "ok"}
    assert sum(payload["counts"].values()) == len(payload["findings"])
    assert set(payload["counts"]) == {"blocked", "critical", "warning", "manual", "ok"}
    assert all(
        {
            "code",
            "label",
            "result",
            "severity",
            "level",
            "message",
            "documentation_url",
            "blocks_startup",
        }
        <= set(item)
        for item in payload["findings"]
    )
    assert settings.credential_keys[0] not in response.text
    assert settings.internal_cron_token not in response.text
    assert all(
        item["documentation_url"].startswith("https://docs.bucketreef.ksperis.com/")
        for item in payload["findings"]
    )


def test_production_readiness_reports_admin_passkey_policy_as_critical(monkeypatch, db_session):
    monkeypatch.setattr(
        production_readiness_router,
        "load_app_settings_for_db",
        lambda _db: AppSettings(),
    )

    response = _client(_settings(), db_session).get("/api/admin/production-readiness")

    assert response.status_code == 200
    finding = next(
        item for item in response.json()["findings"] if item["code"] == "admin-passkey-policy"
    )
    assert finding["label"] == "Administrator passkey policy"
    assert finding["level"] == "critical"
    assert finding["blocks_startup"] is False


def test_production_readiness_reports_app_settings_load_failure_as_critical(monkeypatch, db_session):
    def fail_load(_db):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(production_readiness_router, "load_app_settings_for_db", fail_load)

    response = _client(_settings(), db_session).get("/api/admin/production-readiness")

    assert response.status_code == 200
    finding = next(item for item in response.json()["findings"] if item["code"] == "app-settings")
    assert finding["level"] == "critical"
    assert "database unavailable" not in response.text


def test_production_readiness_includes_manual_operator_checks(monkeypatch, db_session):
    app_settings = AppSettings()
    app_settings.general.require_passkey_for_admins = True
    monkeypatch.setattr(production_readiness_router, "load_app_settings_for_db", lambda _db: app_settings)

    response = _client(_settings(), db_session).get("/api/admin/production-readiness")

    assert response.status_code == 200
    manual = [item for item in response.json()["findings"] if item["level"] == "manual"]
    assert manual
    assert all(item["result"] == "manual" for item in manual)


def test_production_readiness_uses_ui_superadmin_dependency(db_session):
    response = _client(_settings(), db_session, authorized=False).get("/api/admin/production-readiness")

    assert response.status_code == 403
