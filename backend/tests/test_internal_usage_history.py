# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from app.routers import dependencies
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.data_retention_service import DataRetentionService


def _monitor_result(**overrides):
    result = {
        "started_at": "2026-10-23T08:00:00+00:00",
        "finished_at": "2026-10-23T08:00:01+00:00",
        "subjects_total": 0,
        "subjects_processed": 0,
        "history_hourly_upserts": 0,
        "history_daily_upserts": 0,
        "alerts_triggered": 0,
        "alerts_sent": 0,
        "notifications_created": 0,
        "email_errors": 0,
        "errors": [],
        "warnings": [],
        "quota_alerts_enabled": False,
        "quota_alerts_configured": True,
        "usage_history_enabled": True,
        "usage_history_collection_enabled": False,
        "threshold_percent": 85,
        "retention": {
            "quota_history": {
                "hourly_retention_days": 30,
                "daily_retention_days": 365,
                "deleted_hourly": 0,
                "deleted_daily": 0,
            },
            "cost_history": {
                "daily_retention_days": 365,
                "deleted_usage_daily": 0,
                "deleted_storage_daily": 0,
            },
        },
    }
    result.update(overrides)
    return result


def test_internal_usage_history_collect_uses_daily_history_mode(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    calls: list[dict[str, bool]] = []

    def fake_run_monitor(
        self,
        *,
        include_quota_alerts: bool = True,
        include_usage_history: bool = True,
    ):
        calls.append(
            {
                "include_quota_alerts": include_quota_alerts,
                "include_usage_history": include_usage_history,
            }
        )
        return _monitor_result(
            subjects_total=2,
            subjects_processed=2,
            history_hourly_upserts=2,
            history_daily_upserts=2,
            usage_history_collection_enabled=True,
        )

    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", fake_run_monitor)

    response = client.post(
        "/api/internal/usage-history/collect",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert calls == [{"include_quota_alerts": False, "include_usage_history": True}]
    assert response.json()["subjects_processed"] == 2


def test_internal_quota_monitor_does_not_persist_usage_history(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    calls: list[dict[str, bool]] = []

    def fake_run_monitor(
        self,
        *,
        include_quota_alerts: bool = True,
        include_usage_history: bool = True,
    ):
        calls.append(
            {
                "include_quota_alerts": include_quota_alerts,
                "include_usage_history": include_usage_history,
            }
        )
        return _monitor_result(
            subjects_total=1,
            subjects_processed=1,
            quota_alerts_enabled=True,
        )

    monkeypatch.setattr(QuotaMonitoringService, "run_monitor", fake_run_monitor)

    response = client.post(
        "/api/internal/quota-monitor/run",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert calls == [{"include_quota_alerts": True, "include_usage_history": False}]
    assert response.json()["history_hourly_upserts"] == 0


def test_internal_notification_retention_runs_scoped_purge(client, monkeypatch):
    monkeypatch.setattr(dependencies.settings, "internal_cron_token", "expected-token")
    monkeypatch.setattr(
        DataRetentionService,
        "purge_user_notifications",
        lambda self: {
            "user_notifications": {
                "retention_days": 90,
                "deleted": 4,
            }
        },
    )

    response = client.post(
        "/api/internal/notifications/purge",
        headers={"X-Internal-Token": "expected-token"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "status": "completed",
        "user_notifications": {"retention_days": 90, "deleted": 4},
    }
