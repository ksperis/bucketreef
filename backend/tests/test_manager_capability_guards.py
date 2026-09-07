# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import S3Account, S3Connection, StorageEndpoint, User
from app.main import app
from app.models.account_capabilities import AccountCapabilities
from app.models.app_settings import AppSettings
from app.models.bucket_purge import bucket_purge_confirmation_phrase
from app.models.session import ManagerSessionPrincipal, SessionCapabilities
from app.routers.dependencies_internal import feature_gates
from app.routers import dependencies
from app.routers.manager import integrity, purge, stats
from app.routers.manager.access import require_bucket_management_context
from app.services.connection_identity_service import ConnectionIdentityResolution
from app.services.s3_execution_context import S3ExecutionContext


GATES = [
    feature_gates.require_iam_capable_manager,
    feature_gates.require_sns_capable_manager,
    feature_gates.require_usage_capable_manager,
    feature_gates.require_metrics_capable_manager,
]
METRIC_GATES = GATES[2:]


@pytest.fixture(autouse=True)
def enabled_settings(monkeypatch):
    monkeypatch.setattr(feature_gates.app_settings_service, "load_app_settings", AppSettings)


def _context(kind="account"):
    return S3ExecutionContext(
        context_id=f"{kind}:selected", context_kind=kind, name="Selected",
        access_key="TEST-AK", secret_key="TEST-SK", rgw_user_uid="selected-user",
        manager_capabilities=AccountCapabilities(can_manage_buckets=True, can_manage_iam=True),
        storage_endpoint=StorageEndpoint(
            id=1, name="Ceph", endpoint_url="https://ceph.example.test", provider="ceph",
            supervision_access_key="SUP-AK", supervision_secret_key="SUP-SK",
            features_config="features:\n  iam:\n    enabled: true\n  sns:\n    enabled: true\n  metrics:\n    enabled: true\n  usage:\n    enabled: true\n",
        ),
    )


def _actor(kind="account", *, traffic=True):
    if kind == "session":
        return ManagerSessionPrincipal(
            session_id="direct", access_key="TEST-AK", secret_key="TEST-SK", actor_type="s3_key",
            account_id="external-account", account_name="Direct", user_uid="direct-user",
            capabilities=SessionCapabilities(can_manage_buckets=True, can_view_traffic=traffic),
        )
    return User(email="manager@example.test", hashed_password="x", role="ui_user")


@pytest.mark.parametrize("gate", GATES)
@pytest.mark.parametrize("invalid", ["missing-capabilities", "legacy-account"])
def test_manager_guards_reject_context_without_explicit_capabilities(gate, invalid):
    context = _context()
    if invalid == "missing-capabilities":
        context.manager_capabilities = None
    else:
        context = S3Account(name="legacy", storage_endpoint=context.storage_endpoint)

    with pytest.raises(HTTPException) as caught:
        gate(account=context, actor=_actor())

    assert caught.value.status_code == 403


@pytest.mark.parametrize("capabilities", [None, AccountCapabilities()])
def test_bucket_operations_require_explicit_permission(capabilities):
    context = _context()
    context.manager_capabilities = capabilities

    with pytest.raises(HTTPException) as caught:
        require_bucket_management_context(context)

    assert caught.value.status_code == 403


@pytest.mark.parametrize("gate", GATES)
@pytest.mark.parametrize("kind", ["account", "s3_user", "session"])
def test_manager_guards_preserve_authorized_execution_kinds(gate, kind):
    actor = _actor(kind)
    assert gate(account=_context(kind), actor=actor) is actor


def _connection_context():
    context = _context("connection")
    context.s3_connection_id = 8
    context.source_connection = S3Connection(
        id=8, name="Source", access_key_id="TEST-AK", secret_access_key="TEST-SK", storage_endpoint=context.storage_endpoint,
    )
    return context


def _record_lookup(monkeypatch):
    calls = []

    def resolve(_service, source):
        calls.append(source)
        return ConnectionIdentityResolution("resolved-user", "resolved-account", True, True)

    monkeypatch.setattr(feature_gates.ConnectionIdentityService, "resolve_metrics_identity", resolve)
    return calls


@pytest.mark.parametrize("gate", METRIC_GATES)
def test_denied_bucket_capability_stops_before_connection_identity_lookup(monkeypatch, gate):
    context = _connection_context()
    context.manager_capabilities.can_manage_buckets = False
    calls = _record_lookup(monkeypatch)

    with pytest.raises(HTTPException) as caught:
        gate(account=context, actor=_actor())

    assert caught.value.status_code == 403
    assert calls == []
    assert context.rgw_user_uid == "selected-user"


@pytest.mark.parametrize("gate", METRIC_GATES)
@pytest.mark.parametrize("missing", ["source", "id", "mismatched-id"])
def test_connection_metrics_require_complete_matching_source(monkeypatch, gate, missing):
    context = _connection_context()
    if missing == "source":
        context.source_connection = None
        context.s3_connection_id = None
    elif missing == "id":
        context.s3_connection_id = None
    else:
        context.s3_connection_id = 9
    calls = _record_lookup(monkeypatch)

    with pytest.raises(HTTPException) as caught:
        gate(account=context, actor=_actor())

    assert caught.value.status_code == 403
    assert "incomplete" in caught.value.detail
    assert calls == []


@pytest.mark.parametrize("gate", METRIC_GATES)
@pytest.mark.parametrize("kind", ["account", "s3_user", "session"])
def test_connection_source_metadata_does_not_override_execution_kind(monkeypatch, gate, kind):
    context = _connection_context()
    context.context_kind = kind
    actor = _actor(kind)
    calls = _record_lookup(monkeypatch)

    assert gate(account=context, actor=actor) is actor
    assert calls == []
    assert context.rgw_user_uid == "selected-user"


@pytest.mark.parametrize("gate", METRIC_GATES)
def test_complete_connection_still_resolves_identity(monkeypatch, gate):
    context = _connection_context()
    actor = _actor()
    calls = _record_lookup(monkeypatch)

    assert gate(account=context, actor=actor) is actor
    assert calls == [context.source_connection]
    assert context.rgw_user_uid == "resolved-user"
    assert context.rgw_account_id == "resolved-account"


@pytest.mark.parametrize("gate", METRIC_GATES)
@pytest.mark.parametrize("buckets, traffic", [(False, False), (False, True), (True, False), (True, True)])
def test_direct_session_metrics_keep_both_capability_checks(gate, buckets, traffic):
    context = _context("session")
    context.manager_capabilities.can_manage_buckets = buckets
    actor = _actor("session", traffic=traffic)

    if buckets and traffic:
        assert gate(account=context, actor=actor) is actor
    else:
        with pytest.raises(HTTPException) as caught:
            gate(account=context, actor=actor)
        assert caught.value.status_code == 403


@pytest.mark.parametrize("gate, feature", list(zip(GATES, ["iam", "sns", "metrics", "usage"])))
def test_endpoint_feature_flags_still_apply(gate, feature):
    context = _context()
    context.storage_endpoint.features_config = f"features:\n  {feature}:\n    enabled: false\n"

    with pytest.raises(HTTPException) as caught:
        gate(account=context, actor=_actor())

    assert caught.value.status_code == 403
    assert "disabled" in caught.value.detail.lower()


@pytest.mark.parametrize("can_manage_iam", [False, True])
def test_stats_overview_only_reads_iam_when_explicitly_allowed(monkeypatch, can_manage_iam):
    context = _context()
    context.manager_capabilities.can_manage_iam = can_manage_iam
    calls = []

    def iam_client(*args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(
            list_users=lambda: [{}], list_groups=lambda: [{}], list_roles=lambda: [{}], list_policies=lambda: [{}],
        )

    monkeypatch.setattr(stats, "get_iam_service", iam_client)
    result = stats.account_stats(account=context, bucket_service=SimpleNamespace(list_buckets=lambda _account: []))

    assert len(calls) == int(can_manage_iam)
    for key in ["total_iam_users", "total_iam_groups", "total_iam_roles", "total_iam_policies"]:
        assert result[key] == int(can_manage_iam)


@pytest.mark.parametrize("invalid", ["missing-capabilities", "denied-buckets"])
@pytest.mark.parametrize("route", ["overview", "traffic", "integrity", "purge"])
def test_http_routes_reject_missing_or_denied_capabilities_before_storage_work(client, monkeypatch, route, invalid):
    context = _context()
    if invalid == "missing-capabilities":
        context.manager_capabilities = None
    else:
        context.manager_capabilities.can_manage_buckets = False
    actor = _actor()
    app.dependency_overrides[dependencies.get_account_context] = lambda: context
    app.dependency_overrides[dependencies.get_current_actor] = lambda: actor
    app.dependency_overrides[dependencies.require_bucket_integrity_check_enabled] = lambda: actor
    app.dependency_overrides[dependencies.require_bucket_purge_enabled] = lambda: actor

    def unexpected_storage_work(*_args, **_kwargs):
        pytest.fail("Rejected contexts must not reach storage work")

    app.dependency_overrides[stats.get_buckets_service] = lambda: SimpleNamespace(list_buckets=unexpected_storage_work)
    monkeypatch.setattr(stats, "TrafficService", unexpected_storage_work)
    monkeypatch.setattr(integrity, "BucketIntegrityCheckService", unexpected_storage_work)
    monkeypatch.setattr(purge, "BucketPurgeService", unexpected_storage_work)
    if route in {"overview", "traffic"}:
        response = client.get(f"/api/manager/stats/{route}")
    else:
        payload = {"buckets": ["bucket"]}
        if route == "purge":
            payload["confirmation"] = bucket_purge_confirmation_phrase(1)
        response = client.post(f"/api/manager/bucket-{route}/stream", json=payload)

    assert response.status_code == 403
    if invalid == "missing-capabilities":
        assert response.json()["detail"] == "Account context unavailable"
    else:
        assert response.json()["detail"] in {
            "Metrics are not available for this account",
            "Bucket management is not allowed for this context",
        }
