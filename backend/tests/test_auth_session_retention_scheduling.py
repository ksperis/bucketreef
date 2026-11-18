# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.routers import dependencies
from app.services.auth_session_service import AuthSessionService
from app.services.operation_lease_service import (
    AUTH_SESSION_RETENTION_OPERATION,
    OperationLeaseService,
)
from tests.operation_lease_test_utils import active_operation_lease_owner


def test_auth_session_retention_requires_internal_token(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")

    response = client.post(
        "/api/internal/auth-sessions/purge",
        headers={"X-Internal-Token": "wrong-token"},
    )

    assert response.status_code == 401


def test_auth_session_retention_runs_cleanup_and_purge_under_lease(client, db_session, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    calls: list[str] = []

    def fake_cleanup(self):
        calls.append("cleanup")
        return 2

    def fake_purge(self):
        calls.append("purge")
        return {"retention_days": 30, "deleted": 4, "cutoff": "2026-10-19T03:30:00+00:00"}

    monkeypatch.setattr(AuthSessionService, "cleanup_expired", fake_cleanup)
    monkeypatch.setattr(AuthSessionService, "purge_inactive", fake_purge)

    response = client.post(
        "/api/internal/auth-sessions/purge",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert calls == ["cleanup", "purge"]
    assert response.json() == {
        "status": "completed",
        "auth_sessions": {
            "retention_days": 30,
            "deleted": 4,
            "cutoff": "2026-10-19T03:30:00+00:00",
        },
    }
    assert active_operation_lease_owner(db_session, AUTH_SESSION_RETENTION_OPERATION) is None


def test_auth_session_retention_skips_when_already_running(client, db_session, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    lease = OperationLeaseService(db_session).acquire(
        AUTH_SESSION_RETENTION_OPERATION,
        ttl_seconds=600,
        owner="other-worker",
    )
    assert lease is not None

    response = client.post(
        "/api/internal/auth-sessions/purge",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "skipped",
        "reason": "already_running",
        "operation": AUTH_SESSION_RETENTION_OPERATION,
    }
    OperationLeaseService(db_session).release(lease)
