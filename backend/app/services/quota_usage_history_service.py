# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import datetime
from typing import Callable, Optional, TypeVar

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.sqlite import add_and_flush_in_savepoint
from app.db import QuotaUsageDaily, QuotaUsageHourly
from app.services.quota_subject import SubjectContext, quota_subject_ids


_QuotaUsageRow = TypeVar("_QuotaUsageRow", QuotaUsageHourly, QuotaUsageDaily)


class QuotaUsageHistoryService:
    """Persist idempotent hourly and daily quota usage samples."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def upsert_hourly(
        self,
        subject: SubjectContext,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        hour_ts = now.replace(minute=0, second=0, microsecond=0)
        account_id, user_id = quota_subject_ids(subject)
        self._upsert_row(
            model=QuotaUsageHourly,
            period_clause=QuotaUsageHourly.hour_ts == hour_ts,
            subject=subject,
            account_id=account_id,
            user_id=user_id,
            build_row=lambda: QuotaUsageHourly(
                hour_ts=hour_ts,
                storage_endpoint_id=subject.endpoint_id,
                s3_account_id=account_id,
                s3_user_id=user_id,
                used_bytes=int(used_bytes),
                used_objects=int(used_objects),
                bucket_count=int(bucket_count),
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
                usage_ratio_pct=ratio_pct,
                collected_at=now,
            ),
            update_existing=lambda row: self._update_hourly(
                row,
                used_bytes=used_bytes,
                used_objects=used_objects,
                bucket_count=bucket_count,
                quota_size_bytes=quota_size_bytes,
                quota_objects=quota_objects,
                ratio_pct=ratio_pct,
                now=now,
            ),
        )

    def upsert_daily(
        self,
        subject: SubjectContext,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        day = now.date()
        account_id, user_id = quota_subject_ids(subject)
        self._upsert_row(
            model=QuotaUsageDaily,
            period_clause=QuotaUsageDaily.day == day,
            subject=subject,
            account_id=account_id,
            user_id=user_id,
            build_row=lambda: QuotaUsageDaily(
                day=day,
                storage_endpoint_id=subject.endpoint_id,
                s3_account_id=account_id,
                s3_user_id=user_id,
                last_used_bytes=int(used_bytes),
                last_used_objects=int(used_objects),
                bucket_count=int(bucket_count),
                max_ratio_pct=ratio_pct,
                samples_count=1,
                updated_at=now,
            ),
            update_existing=lambda row: self._update_daily(
                row,
                used_bytes=used_bytes,
                used_objects=used_objects,
                bucket_count=bucket_count,
                ratio_pct=ratio_pct,
                now=now,
            ),
        )

    def _upsert_row(
        self,
        *,
        model: type[_QuotaUsageRow],
        period_clause: ColumnElement[bool],
        subject: SubjectContext,
        account_id: Optional[int],
        user_id: Optional[int],
        build_row: Callable[[], _QuotaUsageRow],
        update_existing: Callable[[_QuotaUsageRow], None],
    ) -> None:
        def find_existing() -> Optional[_QuotaUsageRow]:
            return self.db.scalars(
                select(model).where(
                    period_clause,
                    model.storage_endpoint_id == subject.endpoint_id,
                    model.s3_account_id == account_id,
                    model.s3_user_id == user_id,
                )
            ).first()

        existing = find_existing()
        if existing is not None:
            update_existing(existing)
            return
        try:
            add_and_flush_in_savepoint(self.db, build_row())
        except IntegrityError:
            existing = find_existing()
            if existing is None:
                raise
            update_existing(existing)

    @staticmethod
    def _update_hourly(
        row: QuotaUsageHourly,
        *,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        quota_size_bytes: Optional[int],
        quota_objects: Optional[int],
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        row.used_bytes = int(used_bytes)
        row.used_objects = int(used_objects)
        row.bucket_count = int(bucket_count)
        row.quota_size_bytes = quota_size_bytes
        row.quota_objects = quota_objects
        row.usage_ratio_pct = ratio_pct
        row.collected_at = now

    @staticmethod
    def _update_daily(
        row: QuotaUsageDaily,
        *,
        used_bytes: int,
        used_objects: int,
        bucket_count: int,
        ratio_pct: Optional[float],
        now: datetime,
    ) -> None:
        row.last_used_bytes = int(used_bytes)
        row.last_used_objects = int(used_objects)
        row.bucket_count = int(bucket_count)
        if ratio_pct is not None:
            if row.max_ratio_pct is None:
                row.max_ratio_pct = ratio_pct
            else:
                row.max_ratio_pct = max(
                    float(row.max_ratio_pct),
                    ratio_pct,
                )
        row.samples_count = int(row.samples_count) + 1
        row.updated_at = now
