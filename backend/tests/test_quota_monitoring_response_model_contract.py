# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.quota_monitoring import QuotaMonitoringResult


def test_quota_monitoring_result_requires_complete_canonical_payload() -> None:
    assert set(QuotaMonitoringResult.model_json_schema()["required"]) == {
        "started_at",
        "finished_at",
        "subjects_total",
        "subjects_processed",
        "history_hourly_upserts",
        "history_daily_upserts",
        "alerts_triggered",
        "alerts_sent",
        "notifications_created",
        "email_errors",
        "errors",
        "warnings",
        "quota_alerts_enabled",
        "quota_alerts_configured",
        "usage_history_enabled",
        "usage_history_collection_enabled",
        "threshold_percent",
        "retention",
        "status",
        "reason",
    }
