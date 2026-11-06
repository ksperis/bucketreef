# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import NoReturn, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import StorageEndpointFeatureDisabledError
from app.db import User
from app.models.admin_dashboard_metrics import (
    AdminDashboardScope,
    AdminDashboardStorage,
    AdminDashboardTraffic,
)
from app.models.admin_stats import AdminStorageStats, AdminSummary
from app.models.storage_stats import StorageStats
from app.models.traffic import TrafficStats
from app.routers.dependencies import get_current_ui_admin
from app.services.admin_dashboard_metrics_service import AdminDashboardMetricsService
from app.services.admin_stats_service import AdminStatsService, AdminStatsUpstreamError
from app.services.traffic_service import TrafficWindow
from app.utils.http_errors import raise_http_error_from_value_error, raise_http_exception_from_exception

router = APIRouter(prefix="/admin/stats", tags=["admin-stats"])


def _raise_admin_stats_http_error(exc: ValueError | AdminStatsUpstreamError) -> NoReturn:
    if isinstance(exc, StorageEndpointFeatureDisabledError):
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    if isinstance(exc, AdminStatsUpstreamError):
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    raise_http_error_from_value_error(exc)


@router.get("/dashboard/scope", response_model=AdminDashboardScope)
def dashboard_scope(
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> AdminDashboardScope:
    return AdminDashboardScope.model_validate(AdminDashboardMetricsService(db).scope())


@router.get("/dashboard/storage", response_model=AdminDashboardStorage)
def dashboard_storage(
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> AdminDashboardStorage:
    return AdminDashboardStorage.model_validate(AdminDashboardMetricsService(db).storage())


@router.get("/dashboard/traffic", response_model=AdminDashboardTraffic)
def dashboard_traffic(
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> AdminDashboardTraffic:
    return AdminDashboardTraffic.model_validate(AdminDashboardMetricsService(db).traffic())


@router.get("/summary", response_model=AdminSummary)
def summary_stats(
    actor: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> AdminSummary:
    """
    Lightweight counts-only endpoint used by the admin dashboard.
    Avoids RGW calls to keep the page responsive.
    """
    return AdminSummary.model_validate(AdminStatsService(db).summary(actor))


@router.get("/account", response_model=StorageStats)
def account_stats(
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
    account_id: int = Query(...),
) -> StorageStats:
    try:
        payload = AdminStatsService(db).account(account_id)
    except (ValueError, AdminStatsUpstreamError) as exc:
        _raise_admin_stats_http_error(exc)
    return StorageStats.model_validate(payload)


@router.get("/s3-user", response_model=StorageStats)
def s3_user_stats(
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
    user_id: int = Query(...),
) -> StorageStats:
    try:
        payload = AdminStatsService(db).s3_user(user_id)
    except (ValueError, AdminStatsUpstreamError) as exc:
        _raise_admin_stats_http_error(exc)
    return StorageStats.model_validate(payload)


@router.get("/storage", response_model=AdminStorageStats)
def storage_stats(
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None),
) -> AdminStorageStats:
    try:
        payload = AdminStatsService(db).storage(endpoint_id)
    except (ValueError, AdminStatsUpstreamError) as exc:
        _raise_admin_stats_http_error(exc)
    return AdminStorageStats.model_validate(payload)


@router.get("/traffic", response_model=TrafficStats)
def traffic_stats(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None),
) -> TrafficStats:
    try:
        payload = AdminStatsService(db).traffic(endpoint_id, window=window)
    except (ValueError, AdminStatsUpstreamError) as exc:
        _raise_admin_stats_http_error(exc)
    return TrafficStats.model_validate(payload)
