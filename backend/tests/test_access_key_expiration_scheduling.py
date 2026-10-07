# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.routers import dependencies
from app.services.access_key_expiration_service import AccessKeyExpirationService
from app.services.operation_lease_service import (
    ACCESS_KEY_EXPIRATION_RUN_OPERATION,
    OperationLeaseService,
)


def test_access_key_expiration_cron_requires_internal_token(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")

    response = client.post(
        "/api/internal/access-key-expirations/run",
        headers={"X-Internal-Token": "wrong-token"},
    )

    assert response.status_code == 401


def test_access_key_expiration_cron_runs_under_operation_lease(client, db_session, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    monkeypatch.setattr(
        AccessKeyExpirationService,
        "run_due",
        lambda _self: {"status": "ok", "processed": 2, "enforced": 1, "retried": 1, "blocked": 0, "missing": 0},
    )

    response = client.post(
        "/api/internal/access-key-expirations/run",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["processed"] == 2
    assert OperationLeaseService(db_session).current_owner(ACCESS_KEY_EXPIRATION_RUN_OPERATION) is None


def test_access_key_expiration_cron_skips_when_already_running(client, db_session, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    lease = OperationLeaseService(db_session).acquire(
        ACCESS_KEY_EXPIRATION_RUN_OPERATION,
        ttl_seconds=600,
        owner="other-worker",
    )
    assert lease is not None

    response = client.post(
        "/api/internal/access-key-expirations/run",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "skipped",
        "reason": "already_running",
        "operation": ACCESS_KEY_EXPIRATION_RUN_OPERATION,
    }
    OperationLeaseService(db_session).release(lease)
