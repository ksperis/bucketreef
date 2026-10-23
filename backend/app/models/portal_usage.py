# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal usage and storage-statistics API contracts."""

from datetime import datetime
from typing import Optional

from app.models.base import ApiModel
from app.models.bucket_usage_stats import BucketUsageStatsDistributionEntry, BucketUsageStatsScanMode


class PortalUsageStorageSpace(ApiModel):
    id: str
    name: str
    used_bytes: Optional[int]
    object_count: Optional[int]
    quota_max_size_bytes: Optional[int]
    quota_max_objects: Optional[int]


class PortalUsage(ApiModel):
    used_bytes: Optional[int]
    used_objects: Optional[int]
    quota_max_size_bytes: Optional[int]
    quota_max_objects: Optional[int]
    max_buckets: Optional[int]
    storage_spaces: list[PortalUsageStorageSpace]
    other_storage_space: Optional[PortalUsageStorageSpace]


class PortalStorageSpaceUsageStatsSnapshot(ApiModel):
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
    calculated_at: datetime


class PortalStorageSpaceUsageStatsResponse(ApiModel):
    snapshot: Optional[PortalStorageSpaceUsageStatsSnapshot]
