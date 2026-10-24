# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.models.base import ApiModel


class StorageStatsBucketUsagePoint(ApiModel):
    name: str
    used_bytes: Optional[int]
    object_count: Optional[int]


class StorageStatsBucketOverview(ApiModel):
    bucket_count: int
    non_empty_buckets: int
    empty_buckets: int
    avg_bucket_size_bytes: Optional[int]
    avg_objects_per_bucket: Optional[int]


class StorageStats(ApiModel):
    total_buckets: int
    total_bytes: int
    total_objects: int
    bucket_usage: list[StorageStatsBucketUsagePoint]
    bucket_overview: StorageStatsBucketOverview
