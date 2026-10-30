# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field, model_validator

from app.models.base import ApiModel


class CephAdminBucketIndexCheckRequest(ApiModel):
    fix: bool = False
    check_objects: bool = False
    confirmation: Optional[str] = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def validate_check_objects(self):
        if self.check_objects and not self.fix:
            raise ValueError("check_objects requires fix.")
        if self.fix and not (self.confirmation or "").strip():
            raise ValueError("confirmation is required when fix is enabled.")
        return self


class CephAdminBucketIndexCheckTarget(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    tenant: Optional[str] = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def normalize_target(self):
        self.name = self.name.strip()
        self.tenant = (self.tenant or "").strip() or None
        if not self.name:
            raise ValueError("name is required.")
        return self


class CephAdminBucketIndexCheckBatchRequest(ApiModel):
    targets: list[CephAdminBucketIndexCheckTarget] = Field(min_length=1, max_length=200)
    parallelism: int = Field(default=4, ge=1, le=16)

    @model_validator(mode="after")
    def deduplicate_targets(self):
        deduped: list[CephAdminBucketIndexCheckTarget] = []
        seen: set[tuple[Optional[str], str]] = set()
        for target in self.targets:
            key = (target.tenant, target.name)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(target)
        self.targets = deduped
        return self


CephAdminBucketIndexCheckBatchStatus = Literal["completed", "completed_with_errors", "failed", "canceled"]


class CephAdminBucketIndexCheckBatchBucketResult(ApiModel):
    name: str
    tenant: Optional[str]
    status: Literal["completed", "failed"]
    duration_seconds: float
    operation: Literal["check_bucket_index"]
    rgw_status_code: Optional[int]
    rgw_error_code: Optional[str]
    message: str
    result: Any


class CephAdminBucketIndexCheckBatchProgress(ApiModel):
    request_id: Optional[str]
    stage: Literal["prepare", "completed"]
    bucket_name: Optional[str]
    tenant: Optional[str]
    total_buckets: int
    completed_buckets: int
    failed_buckets: int
    message: Optional[str]


class CephAdminBucketIndexCheckBatchResult(ApiModel):
    status: CephAdminBucketIndexCheckBatchStatus
    total_buckets: int
    completed_buckets: int
    failed_buckets: int
    started_at: datetime
    finished_at: datetime
    buckets: list[CephAdminBucketIndexCheckBatchBucketResult]
