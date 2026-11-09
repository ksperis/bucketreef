# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import sqlite3
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.db import S3Account, S3User, StorageEndpoint
from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as SnapshotRow
from app.models.app_settings import AppSettings
from app.models.bucket_usage_stats import BucketUsageStatsSnapshot
from app.services import bucket_usage_stats_collection_service as collection_module
from app.services.bucket_usage_stats_collection_service import BucketUsageStatsCollectionService
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)
from app.services.operation_lease_service import (
    BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
    OperationLeaseService,
    bucket_usage_stats_bucket_operation_name,
)
from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.time import utcnow


def _snapshot_row(*, account_id: int, bucket_name: str, calculated_at) -> SnapshotRow:
    return SnapshotRow(
        scope_kind="manager",
        scope_id=str(account_id),
        scope_name=f"Account {account_id}",
        bucket_name=bucket_name,
        scan_mode="versions",
        version_listing_available=True,
        object_version_count=0,
        current_version_count=0,
        noncurrent_version_count=0,
        delete_marker_count=0,
        total_bytes=0,
        current_bytes=0,
        noncurrent_bytes=0,
        data_type_distribution=[],
        storage_class_distribution=[],
        size_distribution=[],
        age_distribution=[],
        current_noncurrent_distribution=[],
        calculated_at=calculated_at,
    )


def _busy_snapshot_error() -> OperationalError:
    original = sqlite3.OperationalError("database is locked")
    original.sqlite_errorcode = sqlite3.SQLITE_BUSY_SNAPSHOT
    return OperationalError("COMMIT", (), original)


def test_collection_selects_only_opted_in_due_buckets_oldest_first(db_session, monkeypatch):
    endpoint = StorageEndpoint(
        id=7,
        name="Ceph main",
        endpoint_url="https://ceph.example.test",
        provider="ceph",
    )
    opted_in = S3Account(
        id=1,
        name="Opted in",
        rgw_account_id="RGW00000000000000001",
        rgw_user_uid="RGW00000000000000001-root",
        rgw_access_key="ak-1",
        rgw_secret_key="sk-1",
        storage_endpoint_id=7,
        allow_bucket_usage_stats_collection=True,
    )
    targeted_without_opt_in = S3Account(
        id=2,
        name="Not opted in",
        rgw_account_id="RGW00000000000000002",
        rgw_user_uid="RGW00000000000000002-root",
        rgw_access_key="ak-2",
        rgw_secret_key="sk-2",
        storage_endpoint_id=7,
    )
    stats_disabled = S3Account(
        id=3,
        name="Stats disabled",
        rgw_account_id="RGW00000000000000003",
        rgw_user_uid="RGW00000000000000003-root",
        rgw_access_key="ak-3",
        rgw_secret_key="sk-3",
        storage_endpoint_id=7,
        allow_bucket_usage_stats=False,
        allow_bucket_usage_stats_collection=True,
    )
    opted_in_user = S3User(
        id=4,
        name="Opted in user",
        rgw_user_uid="opted-in-user",
        rgw_tenant="",
        rgw_access_key="user-ak",
        rgw_secret_key="user-sk",
        storage_endpoint_id=7,
        allow_bucket_usage_stats=True,
        allow_bucket_usage_stats_collection=True,
    )
    now = utcnow()
    db_session.add_all([
        endpoint,
        opted_in,
        targeted_without_opt_in,
        stats_disabled,
        opted_in_user,
        _snapshot_row(account_id=1, bucket_name="fresh", calculated_at=now - timedelta(hours=1)),
        _snapshot_row(account_id=1, bucket_name="stale", calculated_at=now - timedelta(hours=25)),
    ])
    db_session.commit()

    settings = AppSettings()
    monkeypatch.setattr(collection_module, "load_app_settings_for_db", lambda _db: settings)

    class FakeBucketsService:
        def list_buckets(self, context, **_kwargs):
            assert isinstance(context, S3ExecutionContext)
            if context.context_kind == "s3_user":
                assert context.context_id == "s3u-4"
                return [SimpleNamespace(name="user-missing")]
            assert context.context_kind == "account"
            assert context.context_id == "1"
            return [SimpleNamespace(name=name) for name in ("fresh", "stale", "missing")]

    captured: dict[str, object] = {}

    class FakeUsageStatsService:
        def run(self, targets, options):
            captured["targets"] = targets
            captured["parallelism"] = options.parallelism
            return SimpleNamespace(
                status="completed",
                completed_buckets=len(targets),
                failed_buckets=0,
                skipped_buckets=0,
            )

    result = BucketUsageStatsCollectionService(
        db_session,
        sessionmaker(bind=db_session.get_bind()),
        buckets_service=FakeBucketsService(),
        usage_stats_service=FakeUsageStatsService(),
    ).collect()

    assert [(target.scope_id, target.bucket_name) for target in captured["targets"]] == [
        ("1", "missing"),
        ("s3u-4", "user-missing"),
        ("1", "stale"),
    ]
    assert captured["parallelism"] == 2
    assert result.eligible_accounts == 2
    assert result.due_buckets == 3


def test_collection_only_skips_operational_bucket_listing_failures(db_session, monkeypatch):
    endpoint = StorageEndpoint(
        id=7,
        name="Ceph main",
        endpoint_url="https://ceph.example.test",
        provider="ceph",
    )
    account = S3Account(
        id=1,
        name="Opted in",
        rgw_account_id="RGW00000000000000001",
        rgw_user_uid="RGW00000000000000001-root",
        rgw_access_key="ak-1",
        rgw_secret_key="sk-1",
        storage_endpoint_id=7,
        allow_bucket_usage_stats_collection=True,
    )
    db_session.add_all([endpoint, account])
    db_session.commit()

    monkeypatch.setattr(collection_module, "load_app_settings_for_db", lambda _db: AppSettings())

    class FailingBucketsService:
        def __init__(self, error):
            self.error = error

        def list_buckets(self, _context, **_kwargs):
            raise self.error

    factory = sessionmaker(bind=db_session.get_bind())
    result = BucketUsageStatsCollectionService(
        db_session,
        factory,
        buckets_service=FailingBucketsService(S3OperationError("provider unavailable")),
    ).collect()

    assert result.skipped_accounts == 1
    assert result.due_buckets == 0

    with pytest.raises(RuntimeError, match="unexpected listing bug"):
        BucketUsageStatsCollectionService(
            db_session,
            factory,
            buckets_service=FailingBucketsService(RuntimeError("unexpected listing bug")),
        ).collect()


def test_collection_keeps_s3_io_outside_transaction_and_busy_retry_does_not_repeat_scan(
    db_session,
    monkeypatch,
):
    endpoint = StorageEndpoint(
        id=7,
        name="Ceph main",
        endpoint_url="https://ceph.example.test",
        provider="ceph",
    )
    account = S3Account(
        id=1,
        name="Opted in",
        rgw_account_id="RGW00000000000000001",
        rgw_user_uid="RGW00000000000000001-root",
        rgw_access_key="ak-1",
        rgw_secret_key="sk-1",
        storage_endpoint_id=7,
        allow_bucket_usage_stats_collection=True,
    )
    db_session.add_all([endpoint, account])
    db_session.commit()
    monkeypatch.setattr(collection_module, "load_app_settings_for_db", lambda _db: AppSettings())

    list_calls = 0

    class FakeBucketsService:
        def list_buckets(self, context, **_kwargs):
            nonlocal list_calls
            list_calls += 1
            assert db_session.in_transaction() is False
            assert isinstance(context, S3ExecutionContext)
            assert context.context_kind == "account"
            assert context.storage_endpoint is None
            assert context.session_endpoint == "https://ceph.example.test"
            return [SimpleNamespace(name="bucket-a")]

    fail_snapshot_commit_once = True

    class BusyOnceSession(Session):
        def commit(self) -> None:
            nonlocal fail_snapshot_commit_once
            has_snapshot_write = any(isinstance(row, SnapshotRow) for row in [*self.new, *self.dirty])
            if fail_snapshot_commit_once and has_snapshot_write:
                fail_snapshot_commit_once = False
                raise _busy_snapshot_error()
            super().commit()

    factory = sessionmaker(bind=db_session.get_bind(), class_=BusyOnceSession)
    usage_service = BucketUsageStatsService(factory)
    scan_calls = 0

    def calculate_bucket(target, **_kwargs):
        nonlocal scan_calls
        scan_calls += 1
        assert db_session.in_transaction() is False
        return BucketUsageStatsSnapshot(
            scope_kind=target.scope_kind,
            scope_id=target.scope_id,
            scope_name=target.scope_name,
            bucket_name=target.bucket_name,
            bucket_tenant=target.bucket_tenant,
            scan_mode="versions",
            version_listing_available=True,
            object_version_count=1,
            current_version_count=1,
            noncurrent_version_count=0,
            delete_marker_count=0,
            total_bytes=123,
            current_bytes=123,
            noncurrent_bytes=0,
            data_type_distribution=[],
            storage_class_distribution=[],
            size_distribution=[],
            age_distribution=[],
            current_vs_noncurrent=[],
            warnings=[],
            calculated_at=utcnow(),
        )

    monkeypatch.setattr(usage_service, "calculate_bucket", calculate_bucket)

    result = BucketUsageStatsCollectionService(
        db_session,
        factory,
        buckets_service=FakeBucketsService(),
        usage_stats_service=usage_service,
    ).collect()

    assert result.status == "completed"
    assert list_calls == 1
    assert scan_calls == 1
    assert fail_snapshot_commit_once is False
    db_session.rollback()
    row = db_session.scalars(
        select(SnapshotRow).where(
            SnapshotRow.scope_kind == "manager",
            SnapshotRow.scope_id == "1",
            SnapshotRow.bucket_name == "bucket-a",
        )
    ).one()
    assert row.total_bytes == 123


def test_bucket_scan_is_skipped_when_bucket_lease_is_already_held(db_session, monkeypatch):
    factory = sessionmaker(bind=db_session.get_bind())
    operation = bucket_usage_stats_bucket_operation_name("endpoint:7", "bucket-a")
    lease = OperationLeaseService(db_session).acquire(
        operation,
        ttl_seconds=BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
        owner="existing-scan",
    )
    assert lease is not None

    target = BucketUsageStatsResolvedTarget(
        context=S3ExecutionContext(
            context_id="1",
            context_kind="account",
            name="Account",
            access_key="ak",
            secret_key="sk",
            id=1,
            storage_endpoint_id=7,
        ),
        bucket_name="bucket-a",
        scope_kind="manager",
        scope_id="1",
    )
    service = BucketUsageStatsService(factory)
    monkeypatch.setattr(service, "calculate_and_persist", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("scan must not run")))

    result = service.run([target], BucketUsageStatsOptions(parallelism=1))

    assert result.status == "completed_with_warnings"
    assert result.skipped_buckets == 1
    assert result.buckets[0].status == "skipped"


def test_usage_run_aggregates_mixed_results_and_completion_progress(monkeypatch):
    service = BucketUsageStatsService()
    progress = []

    def target(bucket_name: str) -> BucketUsageStatsResolvedTarget:
        return BucketUsageStatsResolvedTarget(
            context=S3ExecutionContext(
                context_id="1",
                context_kind="account",
                name="Account",
                access_key="ak",
                secret_key="sk",
                id=1,
                storage_endpoint_id=7,
            ),
            bucket_name=bucket_name,
            scope_kind="manager",
            scope_id="1",
            context_id="1",
            context_name="Account",
        )

    def calculate(target, **_kwargs):
        if target.bucket_name == "failed":
            raise RuntimeError("synthetic failure")
        warning = ["partial scan"] if target.bucket_name == "warning" else []
        return BucketUsageStatsSnapshot(
            scope_kind="manager",
            scope_id="1",
            scope_name="Account",
            bucket_name=target.bucket_name,
            bucket_tenant="",
            scan_mode="versions",
            version_listing_available=True,
            object_version_count=2,
            current_version_count=2,
            noncurrent_version_count=0,
            delete_marker_count=1,
            total_bytes=100,
            current_bytes=100,
            noncurrent_bytes=0,
            data_type_distribution=[],
            storage_class_distribution=[],
            size_distribution=[],
            age_distribution=[],
            current_vs_noncurrent=[],
            warnings=warning,
            calculated_at=utcnow(),
        )

    monkeypatch.setattr(service, "calculate_and_persist", calculate)

    result = service.run(
        [target("success"), target("warning"), target("failed")],
        BucketUsageStatsOptions(parallelism=3),
        progress_callback=progress.append,
    )

    assert result.status == "completed_with_warnings"
    assert result.completed_buckets == 3
    assert result.failed_buckets == 1
    assert result.skipped_buckets == 0
    assert result.listed_versions == 4
    assert result.listed_delete_markers == 2
    assert result.total_bytes == 200
    assert {item.bucket_name: item.status for item in result.buckets} == {
        "failed": "failed",
        "success": "completed",
        "warning": "completed_with_warnings",
    }
    completed = [event for event in progress if event.stage == "completed"]
    assert len(completed) == 3
    final_progress = max(completed, key=lambda event: event.completed_buckets)
    assert final_progress.completed_buckets == 3
    assert final_progress.listed_versions == 4
    assert final_progress.listed_delete_markers == 2
    assert final_progress.total_bytes == 200
