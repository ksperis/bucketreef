# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import User, UserRole
from app.routers.manager import context as context_router
from app.services.s3_execution_context import S3ExecutionContext
from tests.s3_account_factory import make_s3_account


def _prepare_context(db_session, monkeypatch):
    account = make_s3_account(db_session, name="limits-account", rgw_account_id="RGW-LIMITS")
    actor = User(
        email="limits@example.test",
        hashed_password="x",
        role=UserRole.UI_ADMIN.value,
    )
    db_session.add_all([account, actor])
    db_session.commit()
    monkeypatch.setattr(context_router, "_manager_stats_state", lambda *_args: (False, None, None))
    monkeypatch.setattr(context_router, "is_manager_bucket_quota_available", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(context_router, "is_manager_rgw_access_key_management_available", lambda *_args, **_kwargs: False)
    return S3ExecutionContext.from_account(account), actor


def test_manager_context_keeps_limits_deferred_by_default(db_session, monkeypatch):
    account, actor = _prepare_context(db_session, monkeypatch)
    monkeypatch.setattr(
        context_router,
        "get_s3_accounts_service",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("limits must stay deferred")),
    )

    payload = context_router.get_manager_context(
        account=account,
        actor=actor,
        db=db_session,
    )

    assert payload.quota_max_size_gb is None
    assert payload.max_buckets is None


def test_manager_context_loads_limits_on_explicit_request(db_session, monkeypatch):
    account, actor = _prepare_context(db_session, monkeypatch)
    service = SimpleNamespace(get_account_limits=lambda _account: (10.5, 2_000, 8, 20, 12, 6))
    monkeypatch.setattr(context_router, "get_s3_accounts_service", lambda *_args, **_kwargs: service)

    payload = context_router.get_manager_context(
        account=account,
        actor=actor,
        db=db_session,
        include_limits=True,
    )

    assert payload.quota_max_size_gb == 10.5
    assert payload.quota_max_objects == 2_000
    assert payload.max_buckets == 8
    assert payload.max_users == 20
    assert payload.max_roles == 12
    assert payload.max_groups == 6


def test_manager_context_resolves_user_access_once(db_session, monkeypatch):
    account, actor = _prepare_context(db_session, monkeypatch)
    original_resolve = context_router.EffectiveAccessService.resolve_user
    resolved_users: list[User] = []

    def resolve_once(service, user):  # noqa: ANN001
        resolved_users.append(user)
        return original_resolve(service, user)

    monkeypatch.setattr(context_router.EffectiveAccessService, "resolve_user", resolve_once)

    context_router.get_manager_context(
        account=account,
        actor=actor,
        db=db_session,
        include_limits=False,
    )

    assert resolved_users == [actor]


@pytest.mark.parametrize(
    ("params", "status_code", "calls"),
    [({}, 200, 0), ({"include_limits": "false"}, 200, 0), ({"include_limits": "true"}, 200, 1),
     ({"include_limits": "invalid"}, 422, 0)],
)
def test_manager_context_limits_http_contract(db_session, monkeypatch, params, status_code, calls):
    account, actor = _prepare_context(db_session, monkeypatch)
    loaded = []

    def get_limits(source):
        loaded.append(source.id)
        return (10.5, 2_000, 8, 20, 12, 6)

    monkeypatch.setattr(
        context_router, "get_s3_accounts_service",
        lambda _db: SimpleNamespace(get_account_limits=get_limits),
    )
    application = FastAPI()
    application.include_router(context_router.router)
    application.dependency_overrides.update({
        context_router.get_account_context: lambda: account,
        context_router.get_current_actor: lambda: actor,
        context_router.get_db: lambda: db_session,
    })
    with TestClient(application) as client:
        response = client.get("/manager/context", params=params)

    assert response.status_code == status_code, response.text
    assert loaded == [account.id] * calls
    if status_code == 200:
        assert response.json()["access_mode"] == "admin"
        assert response.json()["context_kind"] == "account"
        assert response.json()["max_buckets"] == (8 if calls else None)
