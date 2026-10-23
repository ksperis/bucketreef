# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from app.models.base import ApiModel


class QuotaMonitoringSubjectError(ApiModel):
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    error: str


class QuotaMonitoringSubjectWarning(ApiModel):
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    warning: str


class QuotaHistoryRetentionResult(ApiModel):
    hourly_retention_days: int
    daily_retention_days: int
    deleted_hourly: int
    deleted_daily: int


class CostHistoryRetentionResult(ApiModel):
    daily_retention_days: int
    deleted_usage_daily: int
    deleted_storage_daily: int


class QuotaMonitoringRetentionResult(ApiModel):
    quota_history: QuotaHistoryRetentionResult
    cost_history: CostHistoryRetentionResult


class QuotaMonitoringResult(ApiModel):
    started_at: str
    finished_at: str
    subjects_total: int
    subjects_processed: int
    history_hourly_upserts: int
    history_daily_upserts: int
    alerts_triggered: int
    alerts_sent: int
    notifications_created: int
    email_errors: int
    errors: list[QuotaMonitoringSubjectError]
    warnings: list[str | QuotaMonitoringSubjectWarning]
    quota_alerts_enabled: bool
    quota_alerts_configured: bool
    usage_history_enabled: bool
    usage_history_collection_enabled: bool
    threshold_percent: int
    retention: QuotaMonitoringRetentionResult
    status: Optional[Literal["skipped"]] = None
    reason: Optional[str] = None
