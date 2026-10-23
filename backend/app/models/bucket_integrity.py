# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket_operation import (
    BucketNameList,
    RgwBucketReferenceList,
    BucketTargetList,
)


BucketIntegrityStatus = Literal["passed", "completed_with_errors", "failed", "canceled"]
BucketIntegrityCheckMode = Literal["head", "get"]
BucketIntegrityFailureStage = Literal["list", "head", "get"]
BucketIntegrityProgressStage = Literal["prepare", "list", "verify", "completed"]


class BucketIntegrityRequestOptions(ApiModel):
    parallelism: int = Field(default=10, ge=1, le=64)
    all_versions: bool = False
    check_mode: BucketIntegrityCheckMode = "head"
    since: Optional[datetime] = None
    max_mb_per_object: Optional[float] = Field(default=None, gt=0, le=10240)


class BucketIntegrityBucketRequest(BucketIntegrityRequestOptions):
    buckets: BucketNameList


class BucketIntegrityTargetRequest(BucketIntegrityRequestOptions):
    targets: BucketTargetList


class BucketIntegrityRgwTargetRequest(BucketIntegrityRequestOptions):
    targets: RgwBucketReferenceList

class BucketIntegrityFailure(ApiModel):
    bucket_name: str
    stage: BucketIntegrityFailureStage
    message: str
    key: Optional[str]
    version_id: Optional[str]


class BucketIntegrityBucketResult(ApiModel):
    bucket_name: str
    context_id: Optional[str]
    context_name: Optional[str]
    status: BucketIntegrityStatus
    listed_count: int
    checked_count: int
    failed_count: int
    bytes_read: int
    duration_seconds: float
    failures_sample: list[BucketIntegrityFailure]


class BucketIntegrityCheckProgress(ApiModel):
    request_id: Optional[str]
    stage: BucketIntegrityProgressStage
    bucket_name: Optional[str]
    context_id: Optional[str]
    context_name: Optional[str]
    total_buckets: int
    completed_buckets: int
    listed_count: int
    checked_count: int
    failed_count: int
    bytes_read: int
    message: Optional[str]


class BucketIntegrityCheckResult(ApiModel):
    status: BucketIntegrityStatus
    total_buckets: int
    completed_buckets: int
    listed_count: int
    checked_count: int
    failed_count: int
    bytes_read: int
    started_at: datetime
    finished_at: datetime
    buckets: list[BucketIntegrityBucketResult]
