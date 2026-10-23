# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json

from app.models.app_settings import AppSettings
from tests_browser_e2e import serve


def test_app_settings_payload_uses_current_schema():
    payload = serve._build_app_settings_payload()

    settings = AppSettings.model_validate_json(payload)

    assert settings.general.browser_enabled is True
    assert settings.general.manager_enabled is False


def test_prepare_environment_generates_keyring_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("JWT_KEYS", '["ambient-jwt-value"]')
    monkeypatch.setenv("UI_JWT_KEYS", '["ambient-ui-jwt-value"]')
    monkeypatch.setenv("API_JWT_KEYS", '["ambient-api-jwt-value"]')
    monkeypatch.setenv("CREDENTIAL_KEYS", '["ambient-credential-value"]')
    monkeypatch.setenv(
        "ENV_STORAGE_ENDPOINTS",
        '[{"name":"Ambient","endpoint_url":"https://storage.invalid","is_default":true}]',
    )
    monkeypatch.setenv("E2E_FRONTEND_BASE_URL", "http://localhost:44173")

    env = serve._prepare_environment(tmp_path)

    assert "JWT_KEYS" not in env
    assert len(json.loads(env["UI_JWT_KEYS"])) == 1
    assert len(json.loads(env["API_JWT_KEYS"])) == 1
    assert len(json.loads(env["CREDENTIAL_KEYS"])) == 1
    assert env["UI_JWT_KEYS"] != '["ambient-ui-jwt-value"]'
    assert env["API_JWT_KEYS"] != '["ambient-api-jwt-value"]'
    assert env["CREDENTIAL_KEYS"] != '["ambient-credential-value"]'
    assert env["ENV_STORAGE_ENDPOINTS"] == ""
    assert env["PUBLIC_ORIGIN"] == "http://localhost:44173"
    assert json.loads(env["CORS_ORIGINS"]) == [
        "http://localhost:44173",
        "http://127.0.0.1:44173",
    ]
    assert env["E2E_ADMIN_EMAIL"] == "browser-e2e-admin@example.com"
    assert env["E2E_ADMIN_FULL_NAME"] == "Browser E2E Admin"


def test_frontend_origin_rejects_non_loopback_host(monkeypatch):
    monkeypatch.setenv("E2E_FRONTEND_BASE_URL", "https://example.com:4173")

    try:
        serve._frontend_origins()
    except ValueError as exc:
        assert str(exc) == "E2E_FRONTEND_BASE_URL must be an http://localhost origin"
    else:
        raise AssertionError("Expected non-loopback E2E frontend origin to be rejected")
