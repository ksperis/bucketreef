# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.db import User, UserRole
from app.models.account_capabilities import AccountCapabilities
from app.models.app_settings import AppSettings
from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.routers.manager import context as context_router
from app.services.s3_execution_context import S3ExecutionContext


def _context(kind, **kwargs):
    return S3ExecutionContext(
        context_id=f"{kind}:selected",
        context_kind=kind,
        name="Selected context",
        access_key="AK-TEST",
        secret_key="SK-TEST",
        **kwargs,
    )


def _session_actor(**capabilities):
    return ManagerSessionPrincipal(
        session_id="session-test",
        access_key="AK-SESSION",
        secret_key="SK-SESSION",
        actor_type="s3",
        account_id="external-account",
        account_name="External account",
        user_uid="session-user",
        capabilities=SessionCapabilities(**capabilities),
    )


@pytest.fixture
def actor(db_session):
    user = User(email="manager-context@example.test", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(user)
    db_session.commit()
    return user


@pytest.mark.parametrize(
    ("kind", "expected_mode"),
    [("account", "admin"), ("connection", "connection"), ("s3_user", "s3_user"), ("session", "session")],
)
def test_manager_mode_uses_explicit_execution_kind(db_session, actor, kind, expected_mode):
    if kind == "session":
        actor = _session_actor()
    payload = context_router.get_manager_context(
        account=_context(kind), actor=actor, db=db_session, include_limits=False,
    )
    assert payload.access_mode == expected_mode
    if kind == "session":
        assert payload.iam_identity == "session-user"
        assert payload.manager_ceph_keys_enabled is False
        assert payload.manager_private_access_enabled is False


@pytest.mark.parametrize(
    ("kind", "message"),
    [
        ("connection", "Metrics are unavailable: connection context is incomplete."),
        ("s3_user", None),
    ],
)
def test_incomplete_source_metadata_does_not_become_account_metrics(monkeypatch, actor, kind, message):
    settings = AppSettings()
    settings.manager.manager_rgw_usage_metrics_enabled = True
    monkeypatch.setattr(context_router, "load_app_settings", lambda: settings)
    monkeypatch.setattr(context_router, "has_supervision_credentials", lambda _account: True)
    account = _context(kind, manager_capabilities=AccountCapabilities(can_manage_buckets=True))

    assert context_router._manager_stats_state(account, actor) == (False, message, None)


@pytest.mark.parametrize("kind", ["ceph_admin", "portal_account"])
def test_manager_context_rejects_other_surface_kinds_before_loading_state(
    db_session, monkeypatch, actor, kind,
):
    def unexpected_state(*_args):
        raise AssertionError("Unsupported context must be rejected before loading state")

    monkeypatch.setattr(context_router, "_manager_stats_state", unexpected_state)
    with pytest.raises(RuntimeError, match="Unsupported Manager execution context"):
        context_router.get_manager_context(account=_context(kind), actor=actor, db=db_session)


@pytest.mark.parametrize("browser_allowed", [False, True])
@pytest.mark.parametrize("traffic_allowed", [False, True])
def test_manager_context_preserves_direct_session_capabilities(
    db_session, monkeypatch, browser_allowed, traffic_allowed,
):
    settings = AppSettings()
    settings.general.manager_enabled = True
    settings.general.browser_enabled = True
    settings.general.browser_manager_enabled = True
    settings.manager.manager_rgw_usage_metrics_enabled = True
    monkeypatch.setattr(context_router, "load_app_settings", lambda: settings)
    monkeypatch.setattr(context_router, "has_supervision_credentials", lambda _account: True)
    actor = _session_actor(access_browser=browser_allowed, can_view_traffic=traffic_allowed)
    account = _context("session", manager_capabilities=AccountCapabilities(can_manage_buckets=True))

    payload = context_router.get_manager_context(account=account, actor=actor, db=db_session)

    assert payload.access_mode == "session"
    assert payload.iam_identity == "session-user"
    assert payload.manager_browser_enabled is browser_allowed
    assert payload.manager_stats_enabled is traffic_allowed
    assert payload.manager_private_access_enabled is False
    assert payload.manager_bucket_quota_enabled is False
    assert payload.manager_ceph_keys_enabled is False
