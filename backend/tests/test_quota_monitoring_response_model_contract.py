# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.quota_monitoring import (
    QuotaAlertRunResult,
    UsageHistoryCollectionResult,
    UsageHistoryRunResult,
)


def test_quota_alert_run_result_exposes_alert_outcomes_only() -> None:
    assert set(QuotaAlertRunResult.model_json_schema()["required"]) == {
        "started_at",
        "finished_at",
        "subjects_total",
        "subjects_processed",
        "alerts_triggered",
        "alerts_sent",
        "notifications_created",
        "email_errors",
        "errors",
        "warnings",
        "retention",
        "status",
        "reason",
    }


def test_usage_history_run_result_exposes_snapshot_outcomes_only() -> None:
    assert set(UsageHistoryRunResult.model_json_schema()["required"]) == {
        "started_at",
        "finished_at",
        "subjects_total",
        "subjects_processed",
        "history_hourly_upserts",
        "history_daily_upserts",
        "errors",
        "warnings",
        "retention",
        "status",
        "reason",
    }


def test_usage_history_collection_result_exposes_only_frontend_consumed_fields() -> None:
    assert set(UsageHistoryCollectionResult.model_json_schema()["required"]) == {
        "subjects_processed",
        "history_hourly_upserts",
        "history_daily_upserts",
        "errors",
        "warnings",
        "status",
        "reason",
    }
