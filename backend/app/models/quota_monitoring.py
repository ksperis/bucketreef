# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from app.models.base import ApiModel
from app.models.retention import DataRetentionResult


class QuotaMonitoringSubjectError(ApiModel):
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    error: str


class QuotaMonitoringSubjectWarning(ApiModel):
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    warning: str


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
    retention: DataRetentionResult
    status: Optional[Literal["skipped"]] = None
    reason: Optional[str] = None
