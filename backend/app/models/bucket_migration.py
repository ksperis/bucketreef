# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from pydantic import Field, model_validator

from app.models.base import ApiModel


BucketMigrationMode = Literal["one_shot", "pre_sync"]
BucketMigrationStatus = Literal[
    "draft",
    "queued",
    "running",
    "pause_requested",
    "paused",
    "awaiting_cutover",
    "cancel_requested",
    "canceled",
    "completed",
    "completed_with_errors",
    "failed",
    "rolled_back",
]
BucketMigrationPrecheckStatus = Literal["pending", "passed", "failed"]
BucketMigrationItemStatus = Literal[
    "pending",
    "running",
    "awaiting_cutover",
    "paused",
    "skipped",
    "completed",
    "rolled_back",
    "failed",
    "canceled",
]


class BucketMigrationBucketMapping(ApiModel):
    source_bucket: str
    target_bucket: Optional[str] = None

    @model_validator(mode="after")
    def validate_names(self):
        self.source_bucket = (self.source_bucket or "").strip()
        if not self.source_bucket:
            raise ValueError("source_bucket is required")
        if self.target_bucket is not None:
            normalized_target = self.target_bucket.strip()
            self.target_bucket = normalized_target or None
        return self


class BucketMigrationDraftRequest(ApiModel):
    source_context_id: str
    target_context_id: str
    buckets: list[BucketMigrationBucketMapping] = Field(default_factory=list, min_length=1)

    mapping_prefix: str = ""
    mode: BucketMigrationMode = "pre_sync"
    copy_bucket_settings: bool = False
    delete_source: bool = False
    strong_integrity_check: bool = False
    lock_target_writes: bool = True
    use_same_endpoint_copy: bool = False
    auto_grant_source_read_for_copy: Optional[bool] = None
    parallelism_max: Optional[int] = Field(default=None, ge=1, le=128)
    @model_validator(mode="after")
    def validate_payload(self):
        if self.delete_source:
            raise ValueError("Source deletion is a separate operation after migration verification")
        self.source_context_id = (self.source_context_id or "").strip()
        self.target_context_id = (self.target_context_id or "").strip()
        self.mapping_prefix = (self.mapping_prefix or "").strip()
        if not self.source_context_id:
            raise ValueError("source_context_id is required")
        if not self.target_context_id:
            raise ValueError("target_context_id is required")
        if self.source_context_id == self.target_context_id:
            raise ValueError("source_context_id and target_context_id must differ")
        seen_source: set[str] = set()
        for entry in self.buckets:
            if entry.source_bucket in seen_source:
                raise ValueError(f"Duplicate source bucket mapping: {entry.source_bucket}")
            seen_source.add(entry.source_bucket)
        return self


class BucketMigrationCreateRequest(BucketMigrationDraftRequest):
    pass


class BucketMigrationUpdateRequest(BucketMigrationDraftRequest):
    configuration_revision: int = Field(ge=1)


class BucketMigrationPrecheckRequest(ApiModel):
    active_checks: bool = False


class BucketMigrationStartRequest(ApiModel):
    configuration_revision: int = Field(ge=1)
    confirm_write_interruption: bool = False


class BucketMigrationConfirmationRequest(ApiModel):
    confirmed: bool = False


class BucketMigrationActionAvailability(ApiModel):
    enabled: bool
    reason: Optional[str]


class BucketMigrationDiagnostic(ApiModel):
    code: str
    severity: Literal["info", "warning", "error"]
    blocking: bool
    scope: str
    message: str
    impact: Optional[str]
    remediation: Optional[str]
    permission: Optional[str]
    context_id: Optional[str]
    bucket: Optional[str]
    details: Optional[dict]


class BucketMigrationItemView(ApiModel):
    id: int
    source_bucket: str
    target_bucket: str
    status: BucketMigrationItemStatus
    step: str
    pre_sync_done: bool
    read_only_applied: bool
    target_lock_applied: bool
    target_bucket_exists: bool
    target_created_by_migration: bool
    recovery_required: bool
    source_deleted: bool
    cleanup_status: str
    cleanup_error: Optional[str]

    objects_copied: int
    objects_deleted: int

    source_count: Optional[int]
    target_count: Optional[int]
    matched_count: Optional[int]
    different_count: Optional[int]
    only_source_count: Optional[int]
    only_target_count: Optional[int]
    diff_sample: Optional[dict]

    error_message: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class BucketMigrationEventView(ApiModel):
    id: int
    item_id: Optional[int]
    level: str
    message: str
    metadata: Optional[dict]
    created_at: datetime


class BucketMigrationView(ApiModel):
    id: int
    created_by_user_id: Optional[int]

    source_context_id: str
    target_context_id: str
    mode: BucketMigrationMode
    copy_bucket_settings: bool
    delete_source: bool
    strong_integrity_check: bool
    lock_target_writes: bool
    use_same_endpoint_copy: bool
    auto_grant_source_read_for_copy: bool
    mapping_prefix: Optional[str]

    status: BucketMigrationStatus
    pause_requested: bool
    cancel_requested: bool
    precheck_status: BucketMigrationPrecheckStatus
    precheck_report: Optional[dict]
    precheck_checked_at: Optional[datetime]
    configuration_revision: int
    checked_revision: Optional[int]
    preparation_status: Literal["unverified", "checking", "blocked", "ready", "stale"]
    preparation_active_checks: bool
    preparation_completed_items: int
    maintenance_operation: Optional[str]
    maintenance_status: str
    maintenance_error: Optional[str]
    available_actions: dict[str, BucketMigrationActionAvailability]

    parallelism_max: int

    total_items: int
    completed_items: int
    failed_items: int
    skipped_items: int
    awaiting_items: int

    error_message: Optional[str]

    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    last_heartbeat_at: Optional[datetime]

    created_at: datetime
    updated_at: datetime


class BucketMigrationDetail(BucketMigrationView):
    items: list[BucketMigrationItemView]
    recent_events: list[BucketMigrationEventView]


class BucketMigrationListResponse(ApiModel):
    items: list[BucketMigrationView]


class BucketMigrationActionResponse(ApiModel):
    id: int
    status: BucketMigrationStatus
    message: str
