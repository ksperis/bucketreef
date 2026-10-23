# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket_operation import (
    RgwBucketReferenceList,
    BucketTargetList,
)


BucketUsageStatsStatus = Literal["completed", "completed_with_warnings", "failed", "canceled"]
BucketUsageStatsBucketStatus = Literal["completed", "completed_with_warnings", "failed", "canceled", "skipped"]
BucketUsageStatsScanMode = Literal["versions", "current_only"]


class BucketUsageStatsRequestOptions(ApiModel):
    parallelism: int = Field(default=8, ge=1, le=32)


class BucketUsageStatsTargetRequest(BucketUsageStatsRequestOptions):
    targets: BucketTargetList


class BucketUsageStatsRgwTargetRequest(BucketUsageStatsRequestOptions):
    targets: RgwBucketReferenceList

class BucketUsageStatsDistributionEntry(ApiModel):
    key: str
    label: str
    count: int
    bytes: int
    ratio_count: float
    ratio_bytes: float


class BucketUsageStatsSnapshot(ApiModel):
    scope_kind: str
    scope_id: str
    scope_name: Optional[str]
    bucket_name: str
    bucket_tenant: str
    scan_mode: BucketUsageStatsScanMode
    version_listing_available: bool
    object_version_count: int
    current_version_count: int
    noncurrent_version_count: int
    delete_marker_count: int
    total_bytes: int
    current_bytes: int
    noncurrent_bytes: int
    data_type_distribution: list[BucketUsageStatsDistributionEntry]
    storage_class_distribution: list[BucketUsageStatsDistributionEntry]
    size_distribution: list[BucketUsageStatsDistributionEntry]
    age_distribution: list[BucketUsageStatsDistributionEntry]
    current_vs_noncurrent: list[BucketUsageStatsDistributionEntry]
    warnings: list[str]
    calculated_at: datetime


class BucketUsageStatsLatestResponse(ApiModel):
    snapshot: Optional[BucketUsageStatsSnapshot]


class BucketUsageStatsAggregate(ApiModel):
    scope_kind: str
    scope_id: str
    scope_name: Optional[str]
    managed_account_count: Optional[int]
    accounts_with_listed_buckets: Optional[int]
    skipped_account_count: Optional[int]
    bucket_count: int
    buckets_with_snapshot: int
    missing_bucket_count: int
    partial_scan_count: int
    object_version_count: int
    current_version_count: int
    noncurrent_version_count: int
    delete_marker_count: int
    total_bytes: int
    current_bytes: int
    noncurrent_bytes: int
    data_type_distribution: list[BucketUsageStatsDistributionEntry]
    storage_class_distribution: list[BucketUsageStatsDistributionEntry]
    size_distribution: list[BucketUsageStatsDistributionEntry]
    age_distribution: list[BucketUsageStatsDistributionEntry]
    current_vs_noncurrent: list[BucketUsageStatsDistributionEntry]
    warnings: list[str]
    oldest_snapshot_at: Optional[datetime]
    newest_snapshot_at: Optional[datetime]


class BucketUsageStatsAggregateResponse(ApiModel):
    aggregate: BucketUsageStatsAggregate


class BucketUsageStatsScopeRequest(ApiModel):
    parallelism: int = Field(default=8, ge=1, le=32)


class BucketUsageStatsBucketResult(ApiModel):
    bucket_name: str
    context_id: Optional[str]
    context_name: Optional[str]
    status: BucketUsageStatsBucketStatus
    snapshot: Optional[BucketUsageStatsSnapshot]
    duration_seconds: float
    message: Optional[str]


class BucketUsageStatsProgress(ApiModel):
    request_id: Optional[str]
    stage: Literal["prepare", "list", "persist", "completed"]
    bucket_name: Optional[str]
    context_id: Optional[str]
    context_name: Optional[str]
    total_buckets: int
    completed_buckets: int
    listed_versions: int
    listed_delete_markers: int
    total_bytes: int
    message: Optional[str]


class BucketUsageStatsResult(ApiModel):
    status: BucketUsageStatsStatus
    total_buckets: int
    completed_buckets: int
    failed_buckets: int
    skipped_buckets: int
    listed_versions: int
    listed_delete_markers: int
    total_bytes: int
    started_at: datetime
    finished_at: datetime
    buckets: list[BucketUsageStatsBucketResult]


class BucketUsageStatsCollectionResult(ApiModel):
    status: BucketUsageStatsStatus
    eligible_accounts: int
    skipped_accounts: int
    due_buckets: int
    completed_buckets: int
    failed_buckets: int
    skipped_buckets: int
