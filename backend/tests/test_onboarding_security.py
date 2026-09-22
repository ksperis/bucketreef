# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import timedelta

import pytest

from app.db import AppSetting, User, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.routers import dependencies
from app.services.api_token_service import ApiTokenService
from app.services.onboarding_service import OnboardingError, OnboardingService
from app.utils.time import utcnow
from tests.auth_test_utils import authenticate_ui_client, trusted_origin_headers


@pytest.mark.parametrize("mode", [
    "anonymous", "user", "admin", "no_csrf", "foreign_origin",
    "stale_mfa", "api_token", "revoked_session", "valid",
])
def test_apply_requires_authorized_recent_interactive_session(db_session, client, monkeypatch, mode):
    # Keep only the isolated test database dependency. Exercise the production
    # role, cookie, CSRF, token-scope and sensitive-action checks unchanged.
    app.dependency_overrides.pop(dependencies.get_current_super_admin, None)
    app.dependency_overrides.pop(dependencies.get_current_account_admin, None)
    role = {"user": UserRole.UI_USER.value, "admin": UserRole.UI_ADMIN.value}.get(mode, UserRole.UI_SUPERADMIN.value)
    user = User(email="onboarding-security@example.test", hashed_password="test-only", role=role, is_active=True)
    settings = AppSettings()
    settings.general.require_passkey_for_admins = True
    db_session.add_all([user, AppSetting(key="default", payload_json=settings.model_dump_json())])
    db_session.commit()
    headers = {}
    if mode == "api_token":
        token, _ = ApiTokenService(db_session).create_for_user(user, name="admin-only", scopes=["admin:write"])
        headers = {"Authorization": f"Bearer {token}"}
    elif mode != "anonymous":
        credentials = authenticate_ui_client(client, db_session, user)
        headers = trusted_origin_headers(csrf_token=credentials.csrf_token)
        if mode == "no_csrf":
            headers.pop("X-CSRF-Token")
        elif mode == "foreign_origin":
            headers["Origin"] = "https://untrusted.example.test"
        elif mode == "stale_mfa":
            credentials.session.mfa_verified_at = utcnow() - timedelta(days=1)
            db_session.commit()
        elif mode == "revoked_session":
            credentials.session.revoked_at = utcnow()
            db_session.commit()

    calls = []

    def reached_service(*_args, **_kwargs):
        calls.append("apply")
        raise OnboardingError("test_service_reached", 409)

    monkeypatch.setattr(OnboardingService, "apply", reached_service)
    payload = {"revision": 1, "confirmed": True, "review_token": "0" * 64}
    response = client.post(
        "/api/admin/onboarding/journeys/00000000-0000-4000-8000-000000000001/apply",
        json=payload, headers=headers,
    )
    permitted = mode == "valid"
    if permitted:
        assert response.status_code == 409
        assert response.json() == {"detail": {"code": "test_service_reached"}}
        assert calls == ["apply"]
    else:
        assert response.status_code in {401, 403}
        assert calls == []
