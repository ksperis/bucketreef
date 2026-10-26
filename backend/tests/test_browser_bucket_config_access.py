# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""The Advanced Browser bucket editor must respect its own execution scope."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.db import User, UserRole
from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.routers import dependencies
from app.routers.browser_bucket_config import require_advanced_browser_bucket_config
from app.routers.manager.bucket_config_common import get_manager_bucket_config_mutation_service
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import get_bucket_configuration_service
from app.services.s3_execution_context import S3ExecutionContext
from app.main import app


def _request(path="/api/browser/buckets/config/archive/versioning", *, workspace=None):
    headers = [] if workspace is None else [(b"x-s3-workspace", workspace.encode())]
    return Request({"type": "http", "path": path, "headers": headers, "method": "PUT"})


def _context(kind="connection"):
    return S3ExecutionContext(
        context_id="conn-1" if kind == "connection" else kind,
        context_kind=kind,
        name="test",
        access_key="AK",
        secret_key="SK",
    )


@pytest.fixture
def browser_user(db_session):
    user = User(
        email="browser-config@example.com",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        browser_advanced_features_enabled=True,
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.mark.parametrize(
    "workspace,path,kind,allowed",
    [
        (None, "/api/browser/buckets/config/archive/versioning", "connection", True),
        ("portal", "/api/browser/buckets/config/archive/versioning", "connection", False),
        ("manager-browser", "/api/browser/buckets/config/archive/versioning", "connection", False),
        (None, "/api/manager/buckets/archive/versioning", "connection", False),
        (None, "/api/browser/buckets/config/archive/versioning", "account", False),
        (None, "/api/browser/buckets/config/archive/versioning", "s3_user", False),
        (None, "/api/browser/buckets/config/archive/versioning", "ceph_admin", False),
        (None, "/api/browser/buckets/config/archive/versioning", "portal_account", False),
    ],
)
def test_browser_bucket_settings_require_advanced_surface_and_connection(
    db_session, browser_user, workspace, path, kind, allowed
):
    def attempt():
        require_advanced_browser_bucket_config(
            _request(path, workspace=workspace), browser_user, db_session, _context(kind)
        )

    if allowed:
        assert attempt() is None
    else:
        with pytest.raises(HTTPException) as exc:
            attempt()
        assert exc.value.status_code == 403


def test_standard_browser_profile_cannot_edit_bucket(db_session, browser_user):
    browser_user.browser_advanced_features_enabled = False
    db_session.commit()
    with pytest.raises(HTTPException) as exc:
        require_advanced_browser_bucket_config(
            _request(), browser_user, db_session, _context()
        )
    assert exc.value.status_code == 403


def _session(*, can_browse):
    return ManagerSessionPrincipal(
        session_id="session-1",
        access_key="AK",
        secret_key="SK",
        actor_type="user",
        account_id=None,
        account_name=None,
        user_uid=None,
        capabilities=SessionCapabilities(access_browser=can_browse),
    )


def test_browser_s3_session_uses_its_session_identity(db_session):
    assert require_advanced_browser_bucket_config(
        _request(), _session(can_browse=True), db_session, _context("session")
    ) is None
    for actor, context in [
        (_session(can_browse=False), _context("session")),
        (_session(can_browse=True), _context("connection")),
    ]:
        with pytest.raises(HTTPException) as exc:
            require_advanced_browser_bucket_config(_request(), actor, db_session, context)
        assert exc.value.status_code == 403


@pytest.mark.parametrize(
    "path,scope",
    [
        ("/api/browser/buckets/config/archive/versioning", "browser"),
        ("/api/manager/buckets/archive/versioning", "manager"),
        ("/api/browser/buckets/config-elsewhere/archive/versioning", "manager"),
    ],
)
def test_mutations_are_audited_in_the_correct_workspace(path, scope):
    mutation = get_manager_bucket_config_mutation_service(
        _request(path), configuration_service=object(), audit_service=object()
    )
    assert mutation.audit_scope == scope


@pytest.mark.parametrize(
    "advanced,workspace,expected_status",
    [
        (True, None, 204),
        (False, None, 403),
        (True, "manager-browser", 403),
    ],
)
def test_http_bucket_configuration_mutation_respects_browser_profile(
    client, browser_user, advanced, workspace, expected_status
):
    browser_user.browser_advanced_features_enabled = advanced
    calls = []

    def fake_update(**kwargs):
        calls.append(kwargs)
        return Response(status_code=204)

    app.dependency_overrides[dependencies.get_current_actor] = lambda: browser_user
    app.dependency_overrides[dependencies.get_s3_execution_context] = lambda: _context()
    app.dependency_overrides[get_bucket_configuration_service] = lambda: SimpleNamespace()
    app.dependency_overrides[get_manager_bucket_config_mutation_service] = lambda: SimpleNamespace(update=fake_update)

    headers = {} if workspace is None else {"X-S3-Workspace": workspace}
    response = client.put(
        "/api/browser/buckets/config/archive/versioning",
        json={"enabled": True},
        headers=headers,
    )
    assert response.status_code == expected_status
    assert len(calls) == (1 if expected_status == 204 else 0)
    if calls:
        assert calls[0]["context"].context_kind == "connection"
        assert calls[0]["bucket_name"] == "archive"
