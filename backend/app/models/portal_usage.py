# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal usage and storage-statistics API contracts."""

from typing import Optional

from app.models.base import ApiModel
from app.models.bucket_usage_stats import BucketUsageStatsSnapshotData


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


class PortalStorageSpaceUsageStatsSnapshot(BucketUsageStatsSnapshotData):
    pass


class PortalStorageSpaceUsageStatsResponse(ApiModel):
    snapshot: Optional[PortalStorageSpaceUsageStatsSnapshot]
