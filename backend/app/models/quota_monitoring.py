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


class UsageHistoryCollectionResult(ApiModel):
    subjects_processed: int
    history_hourly_upserts: int
    history_daily_upserts: int
    errors: list[QuotaMonitoringSubjectError]
    warnings: list[str | QuotaMonitoringSubjectWarning]
    status: Optional[Literal["skipped"]]
    reason: Optional[str]


class QuotaMonitoringRunResult(ApiModel):
    started_at: str
    finished_at: str
    subjects_total: int
    subjects_processed: int
    errors: list[QuotaMonitoringSubjectError]
    warnings: list[str | QuotaMonitoringSubjectWarning]
    retention: DataRetentionResult
    status: Optional[Literal["skipped"]]
    reason: Optional[str]


class QuotaAlertRunResult(QuotaMonitoringRunResult):
    alerts_triggered: int
    alerts_sent: int
    notifications_created: int
    email_errors: int


class UsageHistoryRunResult(QuotaMonitoringRunResult):
    history_hourly_upserts: int
    history_daily_upserts: int
