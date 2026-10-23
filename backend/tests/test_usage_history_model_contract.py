# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.usage_history import (
    UsageHistoryRecord,
    UsageHistoryResponse,
    UsageHistorySummary,
    UsageHistoryTrendPoint,
    UsageHistoryTrendResponse,
    UsageHistoryTrendSummary,
)


def test_usage_history_responses_require_complete_canonical_payloads() -> None:
    assert set(UsageHistorySummary.model_json_schema()["required"]) == {
        "total_records",
        "subjects_count",
        "latest_collected_at",
        "max_usage_ratio_pct",
    }
    assert set(UsageHistoryRecord.model_json_schema()["required"]) == {
        "id",
        "granularity",
        "period_start",
        "storage_endpoint_id",
        "endpoint_name",
        "subject_type",
        "subject_id",
        "subject_name",
        "subject_identifier",
        "used_bytes",
        "used_objects",
        "bucket_count",
        "quota_size_bytes",
        "quota_objects",
        "usage_ratio_pct",
        "samples_count",
        "collected_at",
    }
    assert set(UsageHistoryResponse.model_json_schema()["required"]) == {
        "items",
        "total",
        "page",
        "page_size",
        "has_next",
        "summary",
    }
    assert set(UsageHistoryTrendPoint.model_json_schema()["required"]) == {
        "period_start",
        "used_bytes",
        "used_objects",
        "bucket_count",
        "max_usage_ratio_pct",
        "subjects_count",
        "samples_count",
        "collected_at",
    }
    assert set(UsageHistoryTrendSummary.model_json_schema()["required"]) == {
        "total_records",
        "points_count",
        "subjects_count",
        "latest_used_bytes",
        "latest_used_objects",
        "latest_bucket_count",
        "latest_collected_at",
        "max_usage_ratio_pct",
    }
    assert set(UsageHistoryTrendResponse.model_json_schema()["required"]) == {
        "window",
        "granularity",
        "available",
        "unavailable_reason",
        "points",
        "summary",
    }
