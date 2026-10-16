# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.db import QuotaUsageDaily
from app.models.access_context import ManagerActor
from app.models.healthcheck import WorkspaceEndpointHealthOverviewResponse
from app.models.usage_trends import UsageTrendsResponse
from app.models.usage_history import UsageHistoryTrendResponse, UsageHistoryTrendWindow
from app.routers.dependencies import (
    get_s3_execution_context,
    require_usage_logs_capable_manager,
    require_storage_metrics_capable_manager,
)
from app.core.sensitive_data import sanitized_error_log_detail
from app.services.app_settings_service import load_app_settings
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.healthcheck_query_service import HealthCheckQueryService
from app.services.rgw_admin import RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext
from app.services.traffic_service import TrafficService, TrafficWindow
from app.services.usage_trends_service import (
    build_execution_context_usage_trends,
    execution_context_usage_trend_filters,
)
from app.services.usage_history_service import UsageHistoryService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.time import utcnow
from app.utils.usage_stats import build_bucket_overview

router = APIRouter(prefix="/manager/stats", tags=["manager-stats"])

settings = get_settings()


@router.get("/overview")
def account_stats(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    bucket_service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(require_storage_metrics_capable_manager),
) -> dict:
    if not context.rgw_account_id and not context.rgw_user_uid:
        raise HTTPException(status_code=400, detail="Storage metrics not available for this context")
    try:
        buckets = bucket_service.list_buckets(context)
        total_buckets = len(buckets)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to fetch buckets: {sanitized_error_log_detail(exc)}",
        ) from exc

    total_bytes = sum((bucket.used_bytes or 0) for bucket in buckets if bucket.used_bytes is not None)
    total_objects = sum((bucket.object_count or 0) for bucket in buckets if bucket.object_count is not None)
    bucket_usage = [
        {
            "name": bucket.name,
            "used_bytes": bucket.used_bytes,
            "object_count": bucket.object_count,
        }
        for bucket in buckets
    ]
    bucket_usage.sort(key=lambda bucket: bucket["used_bytes"] or 0, reverse=True)

    return {
        "total_buckets": total_buckets,
        "total_bytes": total_bytes,
        "total_objects": total_objects,
        "bucket_usage": bucket_usage,
        "bucket_overview": build_bucket_overview(bucket_usage),
    }


@router.get("/usage-trends", response_model=UsageTrendsResponse, response_model_exclude_none=True)
def account_usage_trends(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_storage_metrics_capable_manager),
    db: Session = Depends(get_db),
) -> UsageTrendsResponse:
    if not load_app_settings().general.usage_history_enabled:
        return UsageTrendsResponse()
    return build_execution_context_usage_trends(db, context, reference_date=utcnow().date())


@router.get("/usage-history-trends", response_model=UsageHistoryTrendResponse)
def account_usage_history_trends(
    window: UsageHistoryTrendWindow = Query("month"),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_storage_metrics_capable_manager),
    db: Session = Depends(get_db),
) -> UsageHistoryTrendResponse:
    service = UsageHistoryService(db)
    if not load_app_settings().general.usage_history_enabled:
        return service.empty_trends(window=window, unavailable_reason="Usage history is disabled.")
    if context.context_kind == "connection":
        return service.empty_trends(
            window=window,
            unavailable_reason=(
                "Usage history trends are unavailable for private connection contexts because snapshots are stored "
                "for RGW accounts and S3 users."
            ),
        )
    if execution_context_usage_trend_filters(context, QuotaUsageDaily) is None:
        return service.empty_trends(window=window, unavailable_reason="Usage history trends are unavailable for this context.")
    return service.aggregate_trends(
        window=window,
        extra_filter_builder=lambda model: execution_context_usage_trend_filters(context, model) or [],
    )


@router.get("/traffic")
def account_traffic(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(require_usage_logs_capable_manager),
) -> dict:
    try:
        service = TrafficService(context)
    except ValueError as exc:
        raise_http_exception_from_exception(502, exc)
    try:
        return service.get_traffic(window=window, bucket=bucket)
    except ValueError as exc:
        raise_http_exception_from_exception(400, exc)
    except RGWAdminError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Unable to fetch traffic logs: {sanitized_error_log_detail(exc)}",
        ) from exc


@router.get("/endpoint-health", response_model=WorkspaceEndpointHealthOverviewResponse)
def endpoint_health_overview(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
) -> WorkspaceEndpointHealthOverviewResponse:
    app_settings = load_app_settings()
    if not app_settings.general.endpoint_status_enabled:
        raise HTTPException(status_code=403, detail="Endpoint Status feature is disabled.")
    endpoint_id = context.storage_endpoint_id
    if endpoint_id is None:
        return WorkspaceEndpointHealthOverviewResponse(
            generated_at=utcnow().isoformat(),
            incident_highlight_minutes=max(1, int(settings.healthcheck_incident_recent_minutes or 720)),
            endpoint_count=0,
            up_count=0,
            degraded_count=0,
            down_count=0,
            unknown_count=0,
            endpoints=[],
            incidents=[],
        )
    service = HealthCheckQueryService(db)
    return WorkspaceEndpointHealthOverviewResponse(
        **service.build_workspace_health_overview(endpoint_id=int(endpoint_id))
    )
