# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db_transactions import commit_or_rollback
from app.db import (
    CostStorageDaily,
    CostUsageDaily,
    QuotaUsageDaily,
    QuotaUsageHourly,
    UserNotification,
)
from app.utils.time import utcnow


class DataRetentionService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.settings = get_settings()

    def _hourly_cutoff(self) -> datetime | None:
        days = self.settings.quota_history_hourly_retention_days
        if days <= 0:
            return None
        return (utcnow() - timedelta(days=days))

    def _daily_cutoff(self, retention_days: int) -> date | None:
        if retention_days <= 0:
            return None
        return (utcnow().date() - timedelta(days=retention_days))

    def _delete_rows(self, model, *filters) -> int:
        result = self.db.execute(
            delete(model)
            .where(*filters)
            .execution_options(synchronize_session=False)
        )
        return int(result.rowcount or 0)

    def _purge_quota_history(self) -> dict[str, Any]:
        deleted_hourly = 0
        deleted_daily = 0

        hourly_cutoff = self._hourly_cutoff()
        if hourly_cutoff is not None:
            deleted_hourly = self._delete_rows(
                QuotaUsageHourly,
                QuotaUsageHourly.hour_ts < hourly_cutoff,
            )

        daily_cutoff = self._daily_cutoff(self.settings.quota_history_daily_retention_days)
        if daily_cutoff is not None:
            deleted_daily = self._delete_rows(
                QuotaUsageDaily,
                QuotaUsageDaily.day < daily_cutoff,
            )

        return {
            "quota_history": {
                "hourly_retention_days": self.settings.quota_history_hourly_retention_days,
                "daily_retention_days": self.settings.quota_history_daily_retention_days,
                "deleted_hourly": int(deleted_hourly),
                "deleted_daily": int(deleted_daily),
            }
        }

    def _purge_cost_daily(self) -> dict[str, Any]:
        deleted_usage = 0
        deleted_storage = 0

        daily_cutoff = self._daily_cutoff(self.settings.cost_daily_retention_days)
        if daily_cutoff is not None:
            deleted_usage = self._delete_rows(
                CostUsageDaily,
                CostUsageDaily.day < daily_cutoff,
            )
            deleted_storage = self._delete_rows(
                CostStorageDaily,
                CostStorageDaily.day < daily_cutoff,
            )

        return {
            "cost_history": {
                "daily_retention_days": self.settings.cost_daily_retention_days,
                "deleted_usage_daily": int(deleted_usage),
                "deleted_storage_daily": int(deleted_storage),
            }
        }

    def purge_user_notifications(self) -> dict[str, Any]:
        retention_days = self.settings.user_notifications_retention_days
        if retention_days <= 0:
            return {
                "user_notifications": {
                    "retention_days": retention_days,
                    "deleted": 0,
                    "cutoff": None,
                }
            }

        cutoff = utcnow() - timedelta(days=retention_days)
        deleted = self._delete_rows(
            UserNotification,
            UserNotification.created_at < cutoff,
        )
        if deleted:
            commit_or_rollback(self.db)
        return {
            "user_notifications": {
                "retention_days": retention_days,
                "deleted": int(deleted),
                "cutoff": cutoff.isoformat(),
            }
        }

    def purge_all(self) -> dict[str, Any]:
        quota_result = self._purge_quota_history()
        cost_result = self._purge_cost_daily()
        result = {**quota_result, **cost_result}
        quota = result["quota_history"]
        cost = result["cost_history"]
        if (
            quota["deleted_hourly"]
            or quota["deleted_daily"]
            or cost["deleted_usage_daily"]
            or cost["deleted_storage_daily"]
        ):
            commit_or_rollback(self.db)
        return result
