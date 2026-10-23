# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import get_settings
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
        days = int(self.settings.quota_history_hourly_retention_days or 0)
        if days <= 0:
            return None
        return (utcnow() - timedelta(days=days))

    def _daily_cutoff(self, retention_days: int) -> date | None:
        days = int(retention_days or 0)
        if days <= 0:
            return None
        return (utcnow().date() - timedelta(days=days))

    def _delete_rows(self, model, *filters) -> int:
        result = self.db.execute(
            delete(model)
            .where(*filters)
            .execution_options(synchronize_session=False)
        )
        return int(result.rowcount or 0)

    def purge_quota_history(self) -> dict[str, Any]:
        deleted_hourly = 0
        deleted_daily = 0

        hourly_cutoff = self._hourly_cutoff()
        if hourly_cutoff is not None:
            deleted_hourly = self._delete_rows(
                QuotaUsageHourly,
                QuotaUsageHourly.hour_ts < hourly_cutoff,
            )

        daily_cutoff = self._daily_cutoff(int(self.settings.quota_history_daily_retention_days or 0))
        if daily_cutoff is not None:
            deleted_daily = self._delete_rows(
                QuotaUsageDaily,
                QuotaUsageDaily.day < daily_cutoff,
            )

        if deleted_hourly or deleted_daily:
            self.db.commit()

        return {
            "quota_history": {
                "hourly_retention_days": int(self.settings.quota_history_hourly_retention_days or 0),
                "daily_retention_days": int(self.settings.quota_history_daily_retention_days or 0),
                "deleted_hourly": int(deleted_hourly),
                "deleted_daily": int(deleted_daily),
            }
        }

    def purge_cost_daily(self) -> dict[str, Any]:
        deleted_usage = 0
        deleted_storage = 0

        daily_cutoff = self._daily_cutoff(int(self.settings.cost_daily_retention_days or 0))
        if daily_cutoff is not None:
            deleted_usage = self._delete_rows(
                CostUsageDaily,
                CostUsageDaily.day < daily_cutoff,
            )
            deleted_storage = self._delete_rows(
                CostStorageDaily,
                CostStorageDaily.day < daily_cutoff,
            )

        if deleted_usage or deleted_storage:
            self.db.commit()

        return {
            "cost_history": {
                "daily_retention_days": int(self.settings.cost_daily_retention_days or 0),
                "deleted_usage_daily": int(deleted_usage),
                "deleted_storage_daily": int(deleted_storage),
            }
        }

    def purge_user_notifications(self) -> dict[str, Any]:
        retention_days = int(self.settings.user_notifications_retention_days or 0)
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
            self.db.commit()
        return {
            "user_notifications": {
                "retention_days": retention_days,
                "deleted": int(deleted),
                "cutoff": cutoff.isoformat(),
            }
        }

    def purge_all(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        result.update(self.purge_quota_history())
        result.update(self.purge_cost_daily())
        return result
