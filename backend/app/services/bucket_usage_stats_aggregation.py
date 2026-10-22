# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable

from app.models.bucket_usage_stats import (
    BucketUsageStatsAggregate,
    BucketUsageStatsDistributionEntry,
    BucketUsageStatsSnapshot,
)
from app.services.bucket_usage_stats_scan import (
    AGE_BUCKETS,
    CURRENT_VERSION_LABELS,
    DATA_TYPE_LABELS,
    DATA_TYPE_ORDER,
    SIZE_BUCKETS,
    DistributionBuilder,
)


@dataclass(frozen=True)
class _BucketUsageAggregateTotals:
    partial_scan_count: int
    object_version_count: int
    current_version_count: int
    noncurrent_version_count: int
    delete_marker_count: int
    total_bytes: int
    current_bytes: int
    noncurrent_bytes: int
    oldest_snapshot_at: datetime | None
    newest_snapshot_at: datetime | None


@dataclass(frozen=True)
class _BucketUsageAggregateDistributions:
    data_type: list[BucketUsageStatsDistributionEntry]
    storage_class: list[BucketUsageStatsDistributionEntry]
    size: list[BucketUsageStatsDistributionEntry]
    age: list[BucketUsageStatsDistributionEntry]
    current_vs_noncurrent: list[BucketUsageStatsDistributionEntry]


def build_bucket_usage_aggregate(
    *,
    scope_kind: str,
    scope_id: str,
    scope_name: str | None,
    bucket_count: int,
    buckets_with_snapshot: int,
    snapshots: list[BucketUsageStatsSnapshot],
    warnings: Iterable[str] | None = None,
    managed_account_count: int | None = None,
    accounts_with_listed_buckets: int | None = None,
    skipped_account_count: int | None = None,
) -> BucketUsageStatsAggregate:
    missing_bucket_count = max(bucket_count - buckets_with_snapshot, 0)
    totals = _aggregate_totals(snapshots)
    distributions = _aggregate_distributions(snapshots, totals)
    aggregate_warnings = _aggregate_warnings(
        warnings=warnings,
        snapshots=snapshots,
        bucket_count=bucket_count,
        buckets_with_snapshot=buckets_with_snapshot,
        missing_bucket_count=missing_bucket_count,
        partial_scan_count=totals.partial_scan_count,
    )

    return BucketUsageStatsAggregate(
        scope_kind=scope_kind,
        scope_id=scope_id,
        scope_name=scope_name,
        managed_account_count=managed_account_count,
        accounts_with_listed_buckets=accounts_with_listed_buckets,
        skipped_account_count=skipped_account_count,
        bucket_count=bucket_count,
        buckets_with_snapshot=buckets_with_snapshot,
        missing_bucket_count=missing_bucket_count,
        partial_scan_count=totals.partial_scan_count,
        object_version_count=totals.object_version_count,
        current_version_count=totals.current_version_count,
        noncurrent_version_count=totals.noncurrent_version_count,
        delete_marker_count=totals.delete_marker_count,
        total_bytes=totals.total_bytes,
        current_bytes=totals.current_bytes,
        noncurrent_bytes=totals.noncurrent_bytes,
        data_type_distribution=distributions.data_type,
        storage_class_distribution=distributions.storage_class,
        size_distribution=distributions.size,
        age_distribution=distributions.age,
        current_vs_noncurrent=distributions.current_vs_noncurrent,
        warnings=aggregate_warnings,
        oldest_snapshot_at=totals.oldest_snapshot_at,
        newest_snapshot_at=totals.newest_snapshot_at,
    )


def _aggregate_totals(
    snapshots: list[BucketUsageStatsSnapshot],
) -> _BucketUsageAggregateTotals:
    calculated_at_values = [
        snapshot.calculated_at for snapshot in snapshots if snapshot.calculated_at
    ]
    return _BucketUsageAggregateTotals(
        partial_scan_count=sum(
            1
            for snapshot in snapshots
            if snapshot.scan_mode == "current_only"
            or not snapshot.version_listing_available
        ),
        object_version_count=sum(
            snapshot.object_version_count for snapshot in snapshots
        ),
        current_version_count=sum(
            snapshot.current_version_count for snapshot in snapshots
        ),
        noncurrent_version_count=sum(
            snapshot.noncurrent_version_count for snapshot in snapshots
        ),
        delete_marker_count=sum(snapshot.delete_marker_count for snapshot in snapshots),
        total_bytes=sum(snapshot.total_bytes for snapshot in snapshots),
        current_bytes=sum(snapshot.current_bytes for snapshot in snapshots),
        noncurrent_bytes=sum(snapshot.noncurrent_bytes for snapshot in snapshots),
        oldest_snapshot_at=(
            min(calculated_at_values) if calculated_at_values else None
        ),
        newest_snapshot_at=(
            max(calculated_at_values) if calculated_at_values else None
        ),
    )


def _aggregate_warnings(
    *,
    warnings: Iterable[str] | None,
    snapshots: list[BucketUsageStatsSnapshot],
    bucket_count: int,
    buckets_with_snapshot: int,
    missing_bucket_count: int,
    partial_scan_count: int,
) -> list[str]:
    aggregate_warnings: list[str] = []

    def append_once(warning: str) -> None:
        if warning and warning not in aggregate_warnings:
            aggregate_warnings.append(warning)

    for warning in warnings or []:
        append_once(warning)
    if bucket_count > 0 and buckets_with_snapshot == 0:
        append_once("No bucket usage stats snapshot is available yet.")
    elif missing_bucket_count > 0:
        append_once("Some buckets do not have usage stats snapshots yet.")
    if partial_scan_count > 0:
        append_once(
            "Some bucket snapshots were calculated from current-object listings only. "
            "Current/non-current distribution may be incomplete."
        )
    for snapshot in snapshots:
        for warning in snapshot.warnings:
            append_once(warning)
    return aggregate_warnings


def _aggregate_distributions(
    snapshots: list[BucketUsageStatsSnapshot],
    totals: _BucketUsageAggregateTotals,
) -> _BucketUsageAggregateDistributions:
    return _BucketUsageAggregateDistributions(
        data_type=_merge_distribution_entries(
            [snapshot.data_type_distribution for snapshot in snapshots],
            total_count=totals.object_version_count,
            total_bytes=totals.total_bytes,
            labels=DATA_TYPE_LABELS,
            order=DATA_TYPE_ORDER,
        ),
        storage_class=_merge_distribution_entries(
            [snapshot.storage_class_distribution for snapshot in snapshots],
            total_count=totals.object_version_count,
            total_bytes=totals.total_bytes,
        ),
        size=_merge_distribution_entries(
            [snapshot.size_distribution for snapshot in snapshots],
            total_count=totals.object_version_count,
            total_bytes=totals.total_bytes,
            labels={key: label for key, label, _, _ in SIZE_BUCKETS},
            order=[key for key, _, _, _ in SIZE_BUCKETS],
            include_zero_keys=True,
        ),
        age=_merge_distribution_entries(
            [snapshot.age_distribution for snapshot in snapshots],
            total_count=totals.object_version_count,
            total_bytes=totals.total_bytes,
            labels={key: label for key, label, _, _ in AGE_BUCKETS}
            | {"unknown": "Unknown"},
            order=[key for key, _, _, _ in AGE_BUCKETS] + ["unknown"],
            include_zero_keys=True,
        ),
        current_vs_noncurrent=_current_noncurrent_entries(
            current_count=totals.current_version_count,
            current_bytes=totals.current_bytes,
            noncurrent_count=totals.noncurrent_version_count,
            noncurrent_bytes=totals.noncurrent_bytes,
            total_count=totals.object_version_count,
            total_bytes=totals.total_bytes,
        ),
    )


def _merge_distribution_entries(
    groups: list[list[BucketUsageStatsDistributionEntry]],
    *,
    total_count: int,
    total_bytes: int,
    labels: dict[str, str] | None = None,
    order: Iterable[str] | None = None,
    include_zero_keys: bool = False,
) -> list[BucketUsageStatsDistributionEntry]:
    builder = DistributionBuilder(labels or {}, order)
    for entries in groups:
        for entry in entries:
            builder.add(
                entry.key,
                count=entry.count,
                bytes_value=entry.bytes,
                label=entry.label,
            )
    return builder.entries(
        total_count=total_count,
        total_bytes=total_bytes,
        include_zero_keys=include_zero_keys,
    )


def _current_noncurrent_entries(
    *,
    current_count: int,
    current_bytes: int,
    noncurrent_count: int,
    noncurrent_bytes: int,
    total_count: int,
    total_bytes: int,
) -> list[BucketUsageStatsDistributionEntry]:
    builder = DistributionBuilder(
        CURRENT_VERSION_LABELS,
        ["current", "noncurrent"],
    )
    builder.add("current", count=current_count, bytes_value=current_bytes)
    builder.add(
        "noncurrent",
        count=noncurrent_count,
        bytes_value=noncurrent_bytes,
    )
    return builder.entries(
        total_count=total_count,
        total_bytes=total_bytes,
        include_zero_keys=True,
    )
