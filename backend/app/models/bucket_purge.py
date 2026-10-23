# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.bucket_operation import (
    BucketNameList,
    RgwBucketReferenceList,
    BucketTargetList,
)


BucketPurgeStatus = Literal["completed", "completed_with_errors", "failed", "canceled"]
BucketPurgeStage = Literal["prepare", "list", "delete", "versions", "delete_bucket", "completed"]


class BucketPurgeRequestOptions(ApiModel):
    parallelism: int = Field(default=10, ge=1, le=64)
    include_versions: bool = True
    confirmation: str = ""

def bucket_purge_confirmation_phrase(target_count: int) -> str:
    return f"PURGE {target_count} BUCKETS"


def _validate_purge_confirmation(confirmation: str, target_count: int) -> None:
    expected = bucket_purge_confirmation_phrase(target_count)
    if (confirmation or "").strip() != expected:
        raise ValueError(f"Confirmation must be exactly '{expected}'.")


class BucketPurgeBucketRequest(BucketPurgeRequestOptions):
    buckets: BucketNameList

    @model_validator(mode="after")
    def validate_confirmation(self):
        _validate_purge_confirmation(self.confirmation, len(self.buckets))
        return self


class BucketPurgeTargetRequest(BucketPurgeRequestOptions):
    targets: BucketTargetList

    @model_validator(mode="after")
    def validate_confirmation(self):
        _validate_purge_confirmation(self.confirmation, len(self.targets))
        return self


class BucketPurgeRgwTargetRequest(BucketPurgeRequestOptions):
    targets: RgwBucketReferenceList

    @model_validator(mode="after")
    def validate_confirmation(self):
        _validate_purge_confirmation(self.confirmation, len(self.targets))
        return self


class BucketDeleteWithPurgeRequest(ApiModel):
    parallelism: int = Field(default=10, ge=1, le=64)
    confirmation: str = ""


def bucket_delete_with_purge_confirmation_phrase(bucket_name: str) -> str:
    return f"DELETE BUCKET {bucket_name}"


class BucketPurgeFailure(ApiModel):
    bucket_name: str
    stage: str
    message: str
    key: Optional[str]
    version_id: Optional[str]
    count: int


class BucketPurgeBucketResult(ApiModel):
    bucket_name: str
    context_id: Optional[str]
    context_name: Optional[str]
    status: BucketPurgeStatus
    listed_objects: int
    listed_versions: int
    deleted_objects: int
    deleted_versions: int
    failed_count: int
    bucket_deleted: bool
    duration_seconds: float
    failures_sample: list[BucketPurgeFailure]


class BucketPurgeProgress(ApiModel):
    request_id: Optional[str]
    stage: BucketPurgeStage
    bucket_name: Optional[str]
    context_id: Optional[str]
    context_name: Optional[str]
    total_buckets: int
    completed_buckets: int
    listed_objects: int
    listed_versions: int
    deleted_objects: int
    deleted_versions: int
    total_entries_estimate: Optional[int]
    total_entries_final: bool
    failed_count: int
    bucket_deleted: bool
    message: Optional[str]


class BucketPurgeResult(ApiModel):
    status: BucketPurgeStatus
    total_buckets: int
    completed_buckets: int
    listed_objects: int
    listed_versions: int
    deleted_objects: int
    deleted_versions: int
    failed_count: int
    bucket_deleted: bool
    started_at: datetime
    finished_at: datetime
    buckets: list[BucketPurgeBucketResult]
