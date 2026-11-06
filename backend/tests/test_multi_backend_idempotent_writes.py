# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date

import sqlalchemy as sa

from app.db import (
    CostStorageDaily,
    CostUsageDaily,
    EndpointHealthLatest,
    EndpointHealthRollup,
    QuotaUsageDaily,
    QuotaUsageHourly,
    S3Account,
    StorageEndpoint,
    User,
    UserNotification,
)
from app.core.domain_enums import HealthCheckStatus, UserRole
from app.services.cost_collection_service import CostCollector
from app.services.healthcheck_common import (
    DEFAULT_ROLLUP_RESOLUTION_SECONDS,
    HealthCheckResult,
)
from app.services.healthcheck_persistence_service import HealthCheckPersistenceService
from app.services.quota_subject import SubjectContext
from app.services.quota_usage_history_service import QuotaUsageHistoryService
from app.services.user_notifications_service import UserNotificationsService
from app.utils.time import utcnow


def _subject() -> SubjectContext:
    return SubjectContext(
        subject_type="account",
        subject_id=42,
        endpoint_id=7,
        endpoint_name="ceph",
        subject_name="account",
        subject_identifier="account",
        usage_uid="account",
        quota_account_id="account",
        quota_user_uid=None,
        contact_email=None,
    )


def _seed_subject_parents(db_session, *, include_user: bool = False) -> None:
    endpoint = StorageEndpoint(
        id=7,
        name="idempotent-writes-endpoint",
        endpoint_url="https://idempotent-writes.example.test",
    )
    account = S3Account(
        id=42,
        name="idempotent-writes-account",
        rgw_account_id="RGW-IDEMPOTENT-WRITES",
        rgw_user_uid="idempotent-writes-admin",
        storage_endpoint_id=7,
    )
    rows = [endpoint, account]
    if include_user:
        rows.append(
            User(
                id=1,
                email="idempotent-writes@example.test",
                hashed_password="x",
                is_active=True,
                role=UserRole.UI_USER.value,
            )
        )
    db_session.add_all(rows)
    db_session.commit()


def test_quota_usage_history_upserts_keep_one_row(db_session):
    _seed_subject_parents(db_session)
    service = QuotaUsageHistoryService(db_session)
    now = utcnow()
    subject = _subject()

    service.upsert_hourly(subject, 10, 1, 1, 100, 10, 10.0, now)
    service.upsert_hourly(subject, 20, 2, 2, 100, 10, 20.0, now)
    service.upsert_daily(subject, 10, 1, 1, 10.0, now)
    service.upsert_daily(subject, 20, 2, 2, 20.0, now)
    db_session.commit()

    hourly = db_session.scalars(sa.select(QuotaUsageHourly)).one()
    daily = db_session.scalars(sa.select(QuotaUsageDaily)).one()
    assert hourly.used_bytes == 20
    assert hourly.bucket_count == 2
    assert daily.last_used_bytes == 20
    assert daily.samples_count == 2


def test_user_quota_notifications_are_idempotent_per_event_key(db_session):
    _seed_subject_parents(db_session, include_user=True)
    service = UserNotificationsService(db_session)
    now = utcnow()

    first = service.create_quota_alert_notifications(
        user_ids=[1],
        subject_type="account",
        subject_id=42,
        storage_endpoint_id=7,
        event_key="quota:account:42:threshold",
        title="Quota warning",
        message="Usage exceeded threshold.",
        severity="warning",
        payload={"ratio": 90},
        created_at=now,
    )
    second = service.create_quota_alert_notifications(
        user_ids=[1],
        subject_type="account",
        subject_id=42,
        storage_endpoint_id=7,
        event_key="quota:account:42:threshold",
        title="Quota warning",
        message="Usage exceeded threshold.",
        severity="warning",
        payload={"ratio": 90},
        created_at=now,
    )
    db_session.commit()

    assert first == 1
    assert second == 0
    assert db_session.scalar(sa.select(sa.func.count()).select_from(UserNotification)) == 1


def test_cost_daily_upserts_keep_one_row(db_session):
    _seed_subject_parents(db_session)
    collector = CostCollector(db_session)
    day = date(2026, 7, 3)

    collector._upsert_usage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        bytes_in=1,
        bytes_out=2,
        ops_total=3,
        ops_breakdown={"get": 3},
    )
    collector._upsert_usage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        bytes_in=10,
        bytes_out=20,
        ops_total=30,
        ops_breakdown={"get": 30},
    )
    collector._upsert_storage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        total_bytes=100,
        total_objects=1,
    )
    collector._upsert_storage(
        day=day,
        endpoint_id=7,
        s3_account_id=42,
        s3_user_id=None,
        total_bytes=200,
        total_objects=2,
    )

    usage = db_session.scalars(sa.select(CostUsageDaily)).one()
    storage = db_session.scalars(sa.select(CostStorageDaily)).one()
    assert usage.bytes_in == 10
    assert usage.ops_total == 30
    assert storage.total_bytes == 200
    assert storage.total_objects == 2


def test_health_latest_and_rollup_upserts_keep_one_row(db_session):
    _seed_subject_parents(db_session)
    service = HealthCheckPersistenceService(db_session)
    checked_at = utcnow()
    first = HealthCheckResult(
        endpoint_id=7,
        status=HealthCheckStatus.UP,
        checked_at=checked_at,
        latency_ms=12,
        http_status=200,
        error_message=None,
        check_mode="http",
    )
    second = HealthCheckResult(
        endpoint_id=7,
        status=HealthCheckStatus.DEGRADED,
        checked_at=checked_at,
        latency_ms=1200,
        http_status=503,
        error_message=None,
        check_mode="http",
    )

    service._update_latest_entry(first)
    service._update_latest_entry(second)
    service._update_rollup_bucket(first, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
    service._update_rollup_bucket(second, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
    db_session.commit()

    latest = db_session.scalars(sa.select(EndpointHealthLatest)).one()
    rollup = db_session.scalars(sa.select(EndpointHealthRollup)).one()
    assert latest.status == HealthCheckStatus.DEGRADED.value
    assert latest.latency_ms == 1200
    assert rollup.bucket_start == service._bucket_start(checked_at, DEFAULT_ROLLUP_RESOLUTION_SECONDS)
