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


def _client(settings: Settings, *, authorized: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(production_readiness_router.router, prefix="/api")
    app.dependency_overrides[production_readiness_router.get_settings] = lambda: settings
    app.dependency_overrides[production_readiness_router.get_db] = lambda: object()
    if authorized:
        app.dependency_overrides[production_readiness_router.get_current_ui_superadmin] = lambda: object()
    else:
        def deny():
            raise HTTPException(status_code=403, detail="Forbidden")

        app.dependency_overrides[production_readiness_router.get_current_ui_superadmin] = deny
    return TestClient(app)


def test_production_readiness_returns_runtime_profile_summary_without_secrets(monkeypatch):
    settings = _settings(deployment_profile="full")
    app_settings = AppSettings()
    app_settings.general.require_passkey_for_admins = True
    monkeypatch.setattr(
        production_readiness_router,
        "load_app_settings_for_db",
        lambda _db: app_settings,
    )

    response = _client(settings).get("/api/admin/production-readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["environment"] == "development"
    assert payload["profile"] == "full"
    assert payload["status"] in {"pass", "warning", "fail"}
    assert sum(payload["counts"].values()) == len(payload["findings"])
    assert all({"code", "label", "level", "message"} <= set(item) for item in payload["findings"])
    assert settings.credential_keys[0] not in response.text
    assert settings.internal_cron_token not in response.text


def test_production_readiness_reports_admin_passkey_policy_failure(monkeypatch):
    monkeypatch.setattr(
        production_readiness_router,
        "load_app_settings_for_db",
        lambda _db: AppSettings(),
    )

    response = _client(_settings()).get("/api/admin/production-readiness")

    assert response.status_code == 200
    finding = next(
        item for item in response.json()["findings"] if item["code"] == "admin-passkey-policy"
    )
    assert finding["label"] == "Administrator passkey policy"
    assert finding["level"] == "fail"


def test_production_readiness_reports_app_settings_load_failure(monkeypatch):
    def fail_load(_db):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(production_readiness_router, "load_app_settings_for_db", fail_load)

    response = _client(_settings()).get("/api/admin/production-readiness")

    assert response.status_code == 200
    assert response.json()["status"] == "fail"
    finding = next(item for item in response.json()["findings"] if item["code"] == "app-settings")
    assert finding == {
        "code": "app-settings",
        "label": "Application settings",
        "level": "fail",
        "message": (
            "Application settings could not be loaded; production readiness cannot verify "
            "the administrator passkey policy."
        ),
    }


def test_production_readiness_uses_ui_superadmin_dependency():
    response = _client(_settings(), authorized=False).get("/api/admin/production-readiness")

    assert response.status_code == 403
