# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace

from sqlalchemy.orm import sessionmaker

from app.db import S3Account, StorageEndpoint
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
        data_type_distribution_json="[]",
        storage_class_distribution_json="[]",
        size_distribution_json="[]",
        age_distribution_json="[]",
        current_noncurrent_distribution_json="[]",
        calculated_at=calculated_at,
    )


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
    now = utcnow()
    db_session.add_all([
        endpoint,
        opted_in,
        targeted_without_opt_in,
        stats_disabled,
        _snapshot_row(account_id=1, bucket_name="fresh", calculated_at=now - timedelta(hours=1)),
        _snapshot_row(account_id=1, bucket_name="stale", calculated_at=now - timedelta(hours=25)),
    ])
    db_session.commit()

    settings = AppSettings()
    monkeypatch.setattr(collection_module, "load_app_settings_for_db_readonly", lambda _db: settings)

    class FakeBucketsService:
        def list_buckets(self, account, **_kwargs):
            assert account.id == 1
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

    assert [target.bucket_name for target in captured["targets"]] == ["missing", "stale"]
    assert captured["parallelism"] == 2
    assert result.eligible_accounts == 1
    assert result.due_buckets == 2


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
            scan_mode="versions",
            object_version_count=2,
            current_version_count=2,
            delete_marker_count=1,
            total_bytes=100,
            current_bytes=100,
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
