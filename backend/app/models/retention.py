# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.base import ApiModel


class QuotaHistoryRetentionResult(ApiModel):
    hourly_retention_days: int
    daily_retention_days: int
    deleted_hourly: int
    deleted_daily: int


class CostHistoryRetentionResult(ApiModel):
    daily_retention_days: int
    deleted_usage_daily: int
    deleted_storage_daily: int


class DataRetentionResult(ApiModel):
    quota_history: QuotaHistoryRetentionResult
    cost_history: CostHistoryRetentionResult
