# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi import HTTPException
from botocore.exceptions import ClientError

from app.db import AppSetting, User, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.routers.dependencies import get_current_super_admin, get_current_ui_superadmin
from app.routers.admin import onboarding
from app.services.onboarding_service import OnboardingError


def _admin(db_session) -> User:
    user = User(
        email="onboarding-admin@example.com",
        hashed_password="test-only",
        role=UserRole.UI_SUPERADMIN.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def test_status_and_dismiss_api_keep_legacy_fields_without_global_completion(db_session, client):
    user = _admin(db_session)
    db_session.add(AppSetting(key="default", payload_json=AppSettings().model_dump_json()))
    db_session.commit()
    app.dependency_overrides[get_current_super_admin] = lambda: user
    initial = client.get("/api/admin/onboarding")
    assert initial.status_code == 200
    assert initial.json()["complete"] is False
    assert initial.json()["journeys"] == []
    dismissed = client.post("/api/admin/onboarding/dismiss")
    assert dismissed.status_code == 200 and dismissed.json()["dismissed"]
    assert not AppSettings.model_validate_json(db_session.get(AppSetting, "default").payload_json).onboarding.dismissed
    assert client.post("/api/admin/onboarding/resume").json()["dismissed"] is False


@pytest.mark.parametrize("exception,code", [
    (ValueError("secret_key=do-not-return"), "configuration_failed"),
    (ClientError({"Error": {"Code": "AccessDenied", "Message": "secret_key=do-not-return"}}, "ListBuckets"), "storage_access_denied"),
])
def test_storage_errors_never_echo_credentials(exception, code):
    def fail():
        raise exception
    with pytest.raises(HTTPException) as error:
        onboarding._run(fail)
    assert error.value.detail == {"code": code}


@pytest.mark.parametrize("code", ["stale_revision", "env_locked:FEATURE_BROWSER_ENABLED"])
def test_onboarding_domain_error_codes_keep_their_http_contract(code):
    def fail():
        raise OnboardingError(code, 409)

    with pytest.raises(HTTPException) as error:
        onboarding._run(fail)
    assert error.value.status_code == 409
    assert error.value.detail == {"code": code}


@pytest.mark.parametrize("code", [
    "secret_key=domain-secret-canary",
    "https://user:domain-secret-canary@storage.example.test",
    "Authorization: Bearer domain-secret-canary",
])
def test_onboarding_domain_errors_use_shared_secret_redaction(code):
    def fail():
        raise OnboardingError(code)

    with pytest.raises(HTTPException) as error:
        onboarding._run(fail)
    assert error.value.status_code == 400
    assert "domain-secret-canary" not in str(error.value.detail)
    assert "redacted" in error.value.detail["code"]


@pytest.mark.parametrize("method,path,payload", [
    ("post", "/preview", {"endpoint_url": "https://user:request-secret-canary@storage.example.test"}),
    ("put", "/journeys/00000000-0000-4000-8000-000000000001", {
        "draft": {"secret_key": "request-secret-canary"},
    }),
    ("post", "/journeys/00000000-0000-4000-8000-000000000001/apply", {
        "revision": 1, "confirmed": True, "review_token": "0" * 64,
        "access_key": {"value": "request-secret-canary"},
        "secret_key": ["request-secret-canary"],
    }),
])
def test_invalid_onboarding_requests_do_not_echo_input(db_session, client, caplog, method, path, payload):
    user = _admin(db_session)
    app.dependency_overrides[get_current_super_admin] = lambda: user
    app.dependency_overrides[get_current_ui_superadmin] = lambda: user
    response = getattr(client, method)("/api/admin/onboarding" + path, json=payload)
    assert response.status_code == 422
    assert "request-secret-canary" not in response.text
    assert "request-secret-canary" not in caplog.text
    assert response.json() == {"detail": {"code": "invalid_configuration"}}
