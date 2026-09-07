# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.db import QuotaUsageDaily
from app.models.usage_trends import UsageTrendBaseline, UsageTrendsResponse, UsageTrendWindow
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.utils.time import utcnow

USAGE_TREND_WINDOWS: tuple[tuple[UsageTrendWindow, str, int], ...] = (
    ("month", "last 30 days", 28),
    ("week", "last week", 6),
    ("day", "yesterday", 1),
)


def account_usage_trend_filters(account: S3ExecutionTarget, model=QuotaUsageDaily) -> list | None:
    endpoint_id = account.storage_endpoint_id
    if endpoint_id is None:
        return None

    if isinstance(account, S3ExecutionContext):
        if account.context_kind == "s3_user":
            if account.s3_user_id is None:
                return None
            return [
                model.storage_endpoint_id == endpoint_id,
                model.s3_user_id == account.s3_user_id,
                model.s3_account_id.is_(None),
            ]
        if account.context_kind not in {"account", "portal_account", "session"}:
            return None

    if account.id is None:
        return None
    return [
        model.storage_endpoint_id == endpoint_id,
        model.s3_account_id == account.id,
        model.s3_user_id.is_(None),
    ]


def _serialize_usage_trend_baseline(
    row: QuotaUsageDaily,
    *,
    window: UsageTrendWindow,
    label: str,
) -> UsageTrendBaseline:
    return UsageTrendBaseline(
        window=window,
        label=label,
        period_start=row.day.isoformat(),
        used_bytes=int(row.last_used_bytes or 0),
        used_objects=int(row.last_used_objects or 0),
        bucket_count=int(row.bucket_count) if row.bucket_count is not None else None,
        collected_at=row.updated_at.isoformat() if row.updated_at else None,
    )


def select_usage_trend_baseline(
    db: Session,
    *,
    filters: list,
    value_column,
    reference_date: date | None = None,
) -> UsageTrendBaseline | None:
    today = reference_date or utcnow().date()
    for window, label, min_age_days in USAGE_TREND_WINDOWS:
        cutoff = today - timedelta(days=min_age_days)
        row = (
            db.query(QuotaUsageDaily)
            .filter(*filters, QuotaUsageDaily.day <= cutoff, value_column.isnot(None))
            .order_by(QuotaUsageDaily.day.desc(), QuotaUsageDaily.updated_at.desc(), QuotaUsageDaily.id.desc())
            .first()
        )
        if row is not None:
            return _serialize_usage_trend_baseline(row, window=window, label=label)
    return None


def build_account_usage_trends(
    db: Session,
    account: S3ExecutionTarget,
    *,
    reference_date: date | None = None,
) -> UsageTrendsResponse:
    filters = account_usage_trend_filters(account)
    if not filters:
        return UsageTrendsResponse()
    return UsageTrendsResponse(
        storage=select_usage_trend_baseline(
            db,
            filters=filters,
            value_column=QuotaUsageDaily.last_used_bytes,
            reference_date=reference_date,
        ),
        objects=select_usage_trend_baseline(
            db,
            filters=filters,
            value_column=QuotaUsageDaily.last_used_objects,
            reference_date=reference_date,
        ),
        buckets=select_usage_trend_baseline(
            db,
            filters=filters,
            value_column=QuotaUsageDaily.bucket_count,
            reference_date=reference_date,
        ),
    )
