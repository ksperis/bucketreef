# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace
from unittest.mock import Mock
from pathlib import Path

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.db import UserS3Account, UserRole
from app.main import app
from app.models.app_settings import AppSettings
from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.routers import browser_transfer_policy as route
from app.routers.dependencies_internal import ceph_admin_context
from app.routers.dependencies_internal.auth_session import get_current_actor
from app.services import app_settings_service
from app.services.browser_transfer_policy_service import s3_connect_sources
from tests.test_execution_contexts_workspace_filter import _create_account, _create_connection, _create_endpoint, _create_user


@pytest.mark.parametrize("endpoint, path_style, sources", [
    ("https://s3.example.test/path", True, ["https://s3.example.test"]),
    ("https://S3.example.test:9443", False, ["https://s3.example.test:9443", "https://*.s3.example.test:9443"]),
    ("https://s3.eu-west-3.amazonaws.com", False, ["https://s3.eu-west-3.amazonaws.com", "https://*.s3.eu-west-3.amazonaws.com"]),
    ("http://127.0.0.1:5000", False, ["http://127.0.0.1:5000"]),
])
def test_sources_are_limited_to_effective_endpoint(endpoint, path_style, sources):
    assert s3_connect_sources(endpoint, force_path_style=path_style) == sources


@pytest.mark.parametrize("endpoint", [
    "https://s3.test;connect-src *", "https://s3.test\r\nX-Test: injected", "javascript:alert(1)",
    "https://user:" + "password" + "@s3.test", "https://s3.test/?token=secret", "https://s3.test/#fragment",
    "https://*.s3.test", "https://s3.test:99999", "https://s3.test:0", "https://s3%2etest", "https://[::1]:9443",
])
def test_invalid_or_unsupported_sources_are_rejected(endpoint):
    with pytest.raises(ValueError):
        s3_connect_sources(endpoint, force_path_style=False)


@pytest.fixture
def enabled(monkeypatch):
    settings = AppSettings()
    for field in ("browser_enabled", "browser_root_enabled", "browser_manager_enabled", "browser_portal_enabled", "browser_ceph_admin_enabled", "manager_enabled", "portal_enabled", "ceph_admin_enabled"):
        setattr(settings.general, field, True)
    monkeypatch.setattr(app_settings_service, "load_app_settings", lambda: settings)
    monkeypatch.setattr(app_settings_service, "load_app_settings_for_db_readonly", lambda _db: settings)
    monkeypatch.setattr(route, "current_auth_session", lambda *_: SimpleNamespace(id="test-session"))
    return settings


def policy(db, actor, workspace, selector=None, policy_id=None):
    return route.get_direct_transfer_policy(
        Request({"type": "http", "method": "GET", "path": "/api/browser/direct-transfer-policy", "headers": []}),
        Response(), workspace=workspace, context_id=selector, policy_id=policy_id, actor=actor, db=db,
    )


def test_portal_policy_does_not_prepare_iam_or_list_storage_spaces(db_session, monkeypatch, enabled):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="portal")
    account = _create_account(db_session, name="project", rgw_account_id="RGWPROJECT01", storage_endpoint=endpoint)
    link = UserS3Account(user_id=user.id, account_id=account.id, portal_role="portal_user", manager_role=None)
    db_session.add(link); db_session.commit()
    credentials = Mock(side_effect=AssertionError("Policy must not provision credentials"))
    listing = Mock(side_effect=AssertionError("Policy must not list storage spaces"))
    monkeypatch.setattr("app.services.portal_service.PortalService.get_portal_credentials", credentials)
    monkeypatch.setattr("app.services.portal_service.PortalService.list_storage_spaces", listing)
    first = policy(db_session, user, "portal", str(account.id))
    assert first.context_id == str(account.id)
    assert first.connect_sources[0] == endpoint.endpoint_url
    assert set(first.model_dump()) == {"workspace", "context_id", "connect_sources", "policy_id"}
    db_session.delete(link); db_session.commit()
    with pytest.raises(HTTPException) as exc:
        policy(db_session, user, "portal", str(account.id))
    assert exc.value.status_code == 403
    credentials.assert_not_called(); listing.assert_not_called()


def test_manager_policy_uses_same_association_data_access_flag(db_session, enabled):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="manager")
    account = _create_account(db_session, name="manager", rgw_account_id="RGWMANAGER01", storage_endpoint=endpoint)
    link = UserS3Account(user_id=user.id, account_id=account.id, manager_role="account_administrator", portal_role=None, allow_manager_browser_data_access=False)
    db_session.add(link); db_session.commit()
    with pytest.raises(HTTPException) as exc:
        policy(db_session, user, "manager", str(account.id))
    assert exc.value.status_code == 403
    link.allow_manager_browser_data_access = True; db_session.commit()
    assert policy(db_session, user, "manager", str(account.id)).connect_sources[0] == endpoint.endpoint_url
    with pytest.raises(HTTPException):
        policy(db_session, user, "portal", str(account.id))


def test_connection_policy_is_read_only_and_refreshes_after_endpoint_change(db_session, monkeypatch, enabled):
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="source")
    connection = _create_connection(db_session, created_by_user_id=user.id, name="private", can_manage_iam=False, storage_endpoint=endpoint)
    touch = Mock(side_effect=AssertionError("Policy must not touch usage"))
    monkeypatch.setattr("app.services.s3_connections_service.S3ConnectionsService.touch_usage_best_effort", touch)
    first = policy(db_session, user, "browser", f"conn-{connection.id}")
    endpoint.endpoint_url = "https://new-s3.example.test:9443"; db_session.commit()
    second = policy(db_session, user, "browser", f"conn-{connection.id}")
    assert first.policy_id != second.policy_id
    assert second.connect_sources[0] == endpoint.endpoint_url
    with pytest.raises(HTTPException) as exc:
        policy(db_session, user, "browser", f"conn-{connection.id}", first.policy_id)
    assert exc.value.status_code == 403
    touch.assert_not_called()
    connection.is_active = False; db_session.commit()
    with pytest.raises(HTTPException):
        policy(db_session, user, "browser", f"conn-{connection.id}")


def test_custom_connection_still_uses_outbound_validation(db_session, monkeypatch, enabled):
    user = _create_user(db_session)
    connection = _create_connection(db_session, created_by_user_id=user.id, name="manual", can_manage_iam=False)
    validator = Mock(side_effect=ValueError("Forbidden destination"))
    monkeypatch.setattr("app.routers.dependencies_internal.execution_context.validate_user_supplied_s3_endpoint", validator)
    with pytest.raises(HTTPException) as exc:
        policy(db_session, user, "browser", f"conn-{connection.id}")
    assert exc.value.status_code == 403
    validator.assert_called_once()


def test_s3_session_is_pinned_and_cannot_assume_portal(db_session, enabled):
    actor = ManagerSessionPrincipal(session_id="not-exposed", access_key="test-key", secret_key="not-exposed", actor_type="s3", account_id="RGWSESSION01", account_name="Session", user_uid="session-user", capabilities=SessionCapabilities(endpoint_url="https://session.example.test:9443"))
    result = policy(db_session, actor, "browser")
    assert result.context_id is None
    assert result.connect_sources[0] == "https://session.example.test:9443"
    assert "not-exposed" not in result.model_dump_json()
    with pytest.raises(HTTPException):
        policy(db_session, actor, "portal", "1")


def test_ceph_policy_keeps_admin_authority_without_probing_credentials(db_session, monkeypatch, enabled):
    user = _create_user(db_session)
    user.role = UserRole.UI_ADMIN.value; db_session.commit()
    endpoint = _create_endpoint(db_session, name="ceph")
    monkeypatch.setattr(ceph_admin_context.effective_access_service.EffectiveAccessService, "resolve_user", lambda *_: SimpleNamespace(can_access_ceph_admin=True))
    monkeypatch.setattr(ceph_admin_context.CephAdminEndpointService, "get_configured_endpoint", lambda *_: endpoint)
    probe = Mock(side_effect=AssertionError("Policy must not probe storage"))
    monkeypatch.setattr(ceph_admin_context, "validate_ceph_admin_service_identity", probe)
    assert policy(db_session, user, "ceph-admin", f"ceph-admin-{endpoint.id}").connect_sources[0] == endpoint.endpoint_url
    probe.assert_not_called()
    monkeypatch.setattr(ceph_admin_context.effective_access_service.EffectiveAccessService, "resolve_user", lambda *_: SimpleNamespace(can_access_ceph_admin=False))
    with pytest.raises(HTTPException):
        policy(db_session, user, "ceph-admin", f"ceph-admin-{endpoint.id}")


@pytest.mark.parametrize("workspace,flag", [("browser", "browser_root_enabled"), ("portal", "browser_portal_enabled"), ("manager", "browser_manager_enabled"), ("ceph-admin", "browser_ceph_admin_enabled")])
def test_disabled_surface_is_rejected_before_resolving_context(db_session, enabled, workspace, flag):
    setattr(enabled.general, flag, False)
    with pytest.raises(HTTPException) as exc:
        policy(db_session, _create_user(db_session), workspace, "999")
    assert exc.value.status_code == 403


def test_route_requires_auth_and_returns_no_store_policy(client, db_session, enabled):
    denied = client.get("/api/browser/direct-transfer-policy?workspace=browser")
    assert denied.status_code == 401
    assert denied.headers["Cache-Control"] == "no-store"
    user = _create_user(db_session)
    endpoint = _create_endpoint(db_session, name="http-policy")
    connection = _create_connection(db_session, created_by_user_id=user.id, name="private", can_manage_iam=False, storage_endpoint=endpoint)
    app.dependency_overrides[get_current_actor] = lambda: user
    result = client.get(f"/api/browser/direct-transfer-policy?workspace=browser&context_id=conn-{connection.id}")
    assert result.status_code == 200
    assert result.headers["Cache-Control"] == "no-store"
    assert result.headers["X-BucketReef-Transfer-CSP"].endswith(" ".join(result.json()["connect_sources"]))
    assert "connect-src 'self'" not in result.headers["X-BucketReef-Transfer-CSP"]


def test_worker_route_keeps_api_cookie_scope_and_reaches_frontend_ingress():
    root = Path(__file__).resolve().parents[2]
    ingress = (root / "deploy/helm/bucketreef/templates/ingress.yaml").read_text()
    worker = ingress.split("- path: /api/browser/direct-transfer-worker", 1)[1].split("- path: /api\n", 1)[0]
    assert "-frontend" in worker and "-backend" not in worker
    cookies = (root / "backend/app/routers/auth_cookies.py").read_text()
    assert 'path="/api"' in cookies
