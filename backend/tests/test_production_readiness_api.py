# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.config import Settings
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
    if authorized:
        app.dependency_overrides[production_readiness_router.get_current_ui_superadmin] = lambda: object()
    else:
        def deny():
            raise HTTPException(status_code=403, detail="Forbidden")

        app.dependency_overrides[production_readiness_router.get_current_ui_superadmin] = deny
    return TestClient(app)


def test_production_readiness_returns_runtime_profile_summary_without_secrets():
    settings = _settings(deployment_profile="full")

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


def test_production_readiness_uses_ui_superadmin_dependency():
    response = _client(_settings(), authorized=False).get("/api/admin/production-readiness")

    assert response.status_code == 403
