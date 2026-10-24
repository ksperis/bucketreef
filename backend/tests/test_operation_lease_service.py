# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.db import BackendOperationLease
from app.services.operation_lease_service import OperationLeaseService
from app.utils.time import utcnow


def test_operation_lease_acquire_conflict_release_and_reacquire(db_session):
    service = OperationLeaseService(db_session)

    first = service.acquire("healthchecks:run", ttl_seconds=60, owner="backend-a")
    assert first is not None

    conflict = service.acquire("healthchecks:run", ttl_seconds=60, owner="backend-b")
    assert conflict is None
    assert service.current_owner("healthchecks:run") == "backend-a"

    service.release(first)

    second = service.acquire("healthchecks:run", ttl_seconds=60, owner="backend-b")
    assert second is not None
    assert service.current_owner("healthchecks:run") == "backend-b"


def test_operation_lease_same_owner_renews(db_session):
    service = OperationLeaseService(db_session)

    first = service.acquire("quota-monitor:alerts", ttl_seconds=60, owner="backend-a")
    renewed = service.acquire("quota-monitor:alerts", ttl_seconds=120, owner="backend-a")

    assert first is not None
    assert renewed is not None
    assert renewed.lease_until > first.lease_until
    assert db_session.scalar(sa.select(sa.func.count()).select_from(BackendOperationLease)) == 1


def test_operation_lease_expired_row_can_be_taken(db_session):
    expired = BackendOperationLease(
        operation_name="cost:daily:2026-07-03",
        lease_owner="backend-a",
        lease_until=utcnow() - timedelta(seconds=1),
        updated_at=utcnow() - timedelta(minutes=10),
    )
    db_session.add(expired)
    db_session.commit()

    service = OperationLeaseService(db_session)
    acquired = service.acquire("cost:daily:2026-07-03", ttl_seconds=60, owner="backend-b")

    assert acquired is not None
    assert service.current_owner("cost:daily:2026-07-03") == "backend-b"


def test_operation_lease_hold_releases_after_success(db_session):
    service = OperationLeaseService(db_session)

    with service.hold("usage-history:collect", ttl_seconds=60, owner="backend-a") as lease:
        assert lease is not None
        assert service.current_owner("usage-history:collect") == "backend-a"

    assert service.current_owner("usage-history:collect") is None


def test_operation_lease_hold_recovers_failed_transaction_before_release(db_session):
    service = OperationLeaseService(db_session)
    operation_name = "healthchecks:failed-transaction"

    with pytest.raises(IntegrityError):
        with service.hold(operation_name, ttl_seconds=60, owner="backend-a") as lease:
            assert lease is not None
            db_session.add(
                BackendOperationLease(
                    operation_name=operation_name,
                    lease_owner="duplicate",
                    lease_until=utcnow() + timedelta(seconds=60),
                )
            )
            db_session.flush()

    assert service.current_owner(operation_name) is None
    assert db_session.scalar(
        sa.select(sa.func.count()).select_from(BackendOperationLease).where(
            BackendOperationLease.operation_name == operation_name
        )
    ) == 1
