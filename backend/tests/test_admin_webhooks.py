# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.db import AppSetting, AuditLog, User, UserRole, WebhookDelivery
from app.main import app
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.services.app_settings_service import load_app_settings_for_db
from tests.auth_test_utils import authenticate_ui_client, clear_ui_client, trusted_origin_headers


@pytest.fixture
def webhook_client(db_session, monkeypatch):
    def override_get_db():
        yield db_session

    app.dependency_overrides[dependencies.get_db] = override_get_db
    monkeypatch.setattr("app.services.webhook_service.validate_webhook_target_url", lambda *_args, **_kwargs: None)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}


def _user(db_session, *, email: str, role: str) -> User:
    row = User(
        email=email,
        full_name=email.split("@", 1)[0],
        hashed_password="local-password-hash",
        is_active=True,
        role=role,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _set_admin_passkey_policy(db_session, required: bool) -> None:
    load_app_settings_for_db(db_session)
    row = db_session.query(AppSetting).filter(AppSetting.key == "default").one()
    settings = AppSettings.model_validate_json(row.payload_json)
    settings.general.require_passkey_for_admins = required
    row.payload_json = settings.model_dump_json(indent=2)
    db_session.add(row)
    db_session.commit()


def test_webhook_admin_api_lifecycle_keeps_secret_one_shot_and_audit_safe(webhook_client, db_session):
    superadmin = _user(db_session, email="webhook-superadmin@example.test", role=UserRole.UI_SUPERADMIN.value)
    credentials = authenticate_ui_client(webhook_client, db_session, superadmin, mfa_verified=True)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)
    target_url = "https://hooks.example.test/events?token=do-not-audit-this"

    created = webhook_client.post(
        "/api/admin/settings/webhooks",
        json={
            "name": "Automation",
            "url": target_url,
            "enabled": False,
            "event_types": ["audit.admin.update_ui_user"],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    created_payload = created.json()
    endpoint_id = int(created_payload["id"])
    initial_secret = created_payload["signing_secret"]
    assert initial_secret
    assert created_payload["has_signing_secret"] is True

    loaded = webhook_client.get(f"/api/admin/settings/webhooks/{endpoint_id}")
    listed = webhook_client.get("/api/admin/settings/webhooks")
    events = webhook_client.get("/api/admin/settings/webhooks/events")
    assert loaded.status_code == 200
    assert listed.status_code == 200
    assert events.status_code == 200
    assert "signing_secret" not in loaded.json()
    assert "signing_secret" not in listed.json()[0]
    assert any(item["type"] == "audit.admin.update_ui_user" for item in events.json())

    updated = webhook_client.put(
        f"/api/admin/settings/webhooks/{endpoint_id}",
        json={
            "name": "Automation updated",
            "url": target_url,
            "enabled": False,
            "event_types": ["audit.admin.update_ui_user", "system.endpoint_health.changed"],
        },
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Automation updated"

    rotated = webhook_client.post(
        f"/api/admin/settings/webhooks/{endpoint_id}/rotate-secret",
        headers=headers,
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["signing_secret"]
    assert rotated.json()["signing_secret"] != initial_secret

    queued = webhook_client.post(
        f"/api/admin/settings/webhooks/{endpoint_id}/test",
        headers=headers,
    )
    assert queued.status_code == 202, queued.text
    delivery_id = queued.json()["delivery_id"]
    deliveries = webhook_client.get(f"/api/admin/settings/webhooks/{endpoint_id}/deliveries")
    assert deliveries.status_code == 200
    assert any(row["delivery_id"] == delivery_id and row["is_test"] is True for row in deliveries.json())
    assert db_session.query(WebhookDelivery).filter_by(delivery_id=delivery_id).count() == 1

    create_audit = (
        db_session.query(AuditLog)
        .filter(AuditLog.action == "webhook_endpoint.create", AuditLog.entity_id == str(endpoint_id))
        .one()
    )
    metadata = json.loads(create_audit.metadata_json)
    assert metadata["host"] == "hooks.example.test"
    assert target_url not in create_audit.metadata_json
    assert "do-not-audit-this" not in create_audit.metadata_json
    assert initial_secret not in create_audit.metadata_json

    deleted = webhook_client.delete(f"/api/admin/settings/webhooks/{endpoint_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text
    assert webhook_client.get(f"/api/admin/settings/webhooks/{endpoint_id}").status_code == 404


def test_webhook_admin_api_requires_superadmin(webhook_client, db_session):
    admin = _user(db_session, email="webhook-admin@example.test", role=UserRole.UI_ADMIN.value)
    authenticate_ui_client(webhook_client, db_session, admin, mfa_verified=True)

    response = webhook_client.get("/api/admin/settings/webhooks")

    assert response.status_code == 403, response.text


def test_webhook_mutations_require_recent_step_up_when_admin_passkeys_are_required(webhook_client, db_session):
    _set_admin_passkey_policy(db_session, True)
    superadmin = _user(db_session, email="webhook-stepup@example.test", role=UserRole.UI_SUPERADMIN.value)
    credentials = authenticate_ui_client(webhook_client, db_session, superadmin, mfa_verified=False)
    headers = trusted_origin_headers(csrf_token=credentials.csrf_token)

    blocked = webhook_client.post(
        "/api/admin/settings/webhooks",
        json={
            "name": "Blocked without step-up",
            "url": "https://hooks.example.test/blocked",
            "enabled": False,
            "event_types": ["*"],
        },
        headers=headers,
    )
    assert blocked.status_code == 403, blocked.text
    assert blocked.json()["detail"] == "Recent WebAuthn verification required"

    clear_ui_client(webhook_client)
    credentials = authenticate_ui_client(webhook_client, db_session, superadmin, mfa_verified=True)
    allowed = webhook_client.post(
        "/api/admin/settings/webhooks",
        json={
            "name": "Allowed after step-up",
            "url": "https://hooks.example.test/allowed",
            "enabled": False,
            "event_types": ["*"],
        },
        headers=trusted_origin_headers(csrf_token=credentials.csrf_token),
    )
    assert allowed.status_code == 201, allowed.text
