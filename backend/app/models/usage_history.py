# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from app.models.base import ApiModel


UsageHistoryGranularity = Literal["daily", "hourly"]
UsageHistorySubjectType = Literal["all", "account", "s3_user"]
UsageHistoryTrendWindow = Literal["day", "week", "month"]


class UsageHistorySummary(ApiModel):
    total_records: int
    subjects_count: int
    latest_collected_at: Optional[str]
    max_usage_ratio_pct: Optional[float]


class UsageHistoryRecord(ApiModel):
    id: int
    granularity: UsageHistoryGranularity
    period_start: str
    storage_endpoint_id: int
    endpoint_name: str
    subject_type: Literal["account", "s3_user"]
    subject_id: int
    subject_name: str
    subject_identifier: Optional[str]
    used_bytes: int
    used_objects: int
    bucket_count: Optional[int]
    quota_size_bytes: Optional[int]
    quota_objects: Optional[int]
    usage_ratio_pct: Optional[float]
    samples_count: Optional[int]
    collected_at: str


class UsageHistoryResponse(ApiModel):
    items: list[UsageHistoryRecord]
    total: int
    page: int
    page_size: int
    has_next: bool
    summary: UsageHistorySummary


class UsageHistoryTrendPoint(ApiModel):
    period_start: str
    used_bytes: int
    used_objects: int
    bucket_count: int
    max_usage_ratio_pct: Optional[float]
    subjects_count: int
    samples_count: int
    collected_at: Optional[str]


class UsageHistoryTrendSummary(ApiModel):
    total_records: int
    points_count: int
    subjects_count: int
    latest_used_bytes: int
    latest_used_objects: int
    latest_bucket_count: int
    latest_collected_at: Optional[str]
    max_usage_ratio_pct: Optional[float]


class UsageHistoryTrendResponse(ApiModel):
    window: UsageHistoryTrendWindow
    granularity: UsageHistoryGranularity
    available: bool
    unavailable_reason: Optional[str]
    points: list[UsageHistoryTrendPoint]
    summary: UsageHistoryTrendSummary
