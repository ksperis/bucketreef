# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.traffic import TrafficStats
from app.routers.dependencies import get_current_super_admin
from app.services.admin_dashboard_metrics_service import AdminDashboardMetricsService
from app.services.admin_stats_service import AdminStatsService
from app.services.traffic_service import TrafficWindow

router = APIRouter(prefix="/admin/stats", tags=["admin-stats"])


@router.get("/dashboard/scope")
def dashboard_scope(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    return AdminDashboardMetricsService(db).scope()


@router.get("/dashboard/storage")
def dashboard_storage(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    return AdminDashboardMetricsService(db).storage()


@router.get("/dashboard/traffic")
def dashboard_traffic(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    return AdminDashboardMetricsService(db).traffic()


@router.get("/summary")
def summary_stats(
    actor: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    """
    Lightweight counts-only endpoint used by the admin dashboard.
    Avoids RGW calls to keep the page responsive.
    """
    return AdminStatsService(db).summary(actor)


@router.get("/account")
def account_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    account_id: int = Query(...),
) -> dict:
    return AdminStatsService(db).account(account_id)


@router.get("/s3-user")
def s3_user_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    user_id: int = Query(...),
) -> dict:
    return AdminStatsService(db).s3_user(user_id)


@router.get("/storage")
def storage_stats(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None),
) -> dict:
    return AdminStatsService(db).storage(endpoint_id)


@router.get("/traffic", response_model=TrafficStats)
def traffic_stats(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    endpoint_id: Optional[int] = Query(default=None),
) -> TrafficStats:
    return TrafficStats.model_validate(AdminStatsService(db).traffic(endpoint_id, window=window))
