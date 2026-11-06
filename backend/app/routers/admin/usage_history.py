# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.quota_monitoring import UsageHistoryCollectionResult
from app.models.usage_history import (
    UsageHistoryGranularity,
    UsageHistoryListingRequest,
    UsageHistoryResponse,
    UsageHistorySubjectType,
    UsageHistoryTrendResponse,
    UsageHistoryTrendWindow,
)
from app.routers.dependencies import get_current_ui_admin
from app.services.app_settings_service import load_app_settings_for_db
from app.services.operation_lease_service import (
    OperationLeaseService,
    USAGE_HISTORY_COLLECT_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.usage_history_service import UsageHistoryService
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/admin/usage-history", tags=["admin-usage-history"])


def _ensure_usage_history_enabled(db: Session) -> None:
    app_settings = load_app_settings_for_db(db)
    if not app_settings.general.usage_history_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usage history is disabled")


def _parse_boundary(
    value: Optional[str],
    *,
    granularity: UsageHistoryGranularity,
    is_end: bool,
) -> date | datetime | None:
    if not value:
        return None
    try:
        if granularity == "daily":
            return date.fromisoformat(value[:10])
        if "T" not in value:
            parsed_day = date.fromisoformat(value[:10])
            return datetime.combine(
                parsed_day,
                time.max if is_end else time.min,
                tzinfo=timezone.utc,
            )
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError as exc:
        expected = "YYYY-MM-DD" if granularity == "daily" else "YYYY-MM-DD or ISO datetime"
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid date boundary, expected {expected}") from exc


@router.get("", response_model=UsageHistoryResponse)
def list_usage_history(
    query: Annotated[UsageHistoryListingRequest, Query()],
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> UsageHistoryResponse:
    _ensure_usage_history_enabled(db)
    service = UsageHistoryService(db)
    return service.list_records(
        query,
        start=_parse_boundary(query.start, granularity=query.granularity, is_end=False),
        end=_parse_boundary(query.end, granularity=query.granularity, is_end=True),
    )


@router.get("/trends", response_model=UsageHistoryTrendResponse)
def usage_history_trends(
    window: UsageHistoryTrendWindow = Query("month"),
    endpoint_id: Optional[int] = Query(None),
    subject_type: UsageHistorySubjectType = Query("all"),
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> UsageHistoryTrendResponse:
    _ensure_usage_history_enabled(db)
    service = UsageHistoryService(db)
    return service.aggregate_trends(window=window, endpoint_id=endpoint_id, subject_type=subject_type)


@router.post("/collect", response_model=UsageHistoryCollectionResult)
def collect_usage_history(
    current_user: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> UsageHistoryCollectionResult:
    _ensure_usage_history_enabled(db)
    with OperationLeaseService(db).hold(
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "admin", "user_id": current_user.id},
    ) as lease:
        if lease is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Usage history collection is already running.",
            )
        service = QuotaMonitoringService(db)
        try:
            result = service.collect_usage_history()
        except ValueError as exc:
            raise_bad_request_from_value_error(exc)

    return UsageHistoryCollectionResult(
        subjects_processed=result["subjects_processed"],
        history_hourly_upserts=result["history_hourly_upserts"],
        history_daily_upserts=result["history_daily_upserts"],
        errors=result["errors"],
        warnings=result["warnings"],
        status=result["status"],
        reason=result["reason"],
    )
