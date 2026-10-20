# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import CostDisabledError
from app.db import User
from app.models.cost import CostSubjectDetail, CostSubjectsResponse, CostSummary
from app.routers.cost_common import parse_cost_day
from app.routers.dependencies import get_current_super_admin
from app.services.admin_cost_service import AdminCostService
from app.utils.http_errors import raise_http_error_from_value_error
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter(prefix="/admin/cost", tags=["admin-cost"])


def _raise_cost_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, CostDisabledError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cost is disabled") from exc
    raise_http_error_from_value_error(exc)


@router.get("/summary", response_model=CostSummary)
def cost_summary(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int | None = Query(None),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> CostSummary:
    try:
        return AdminCostService(db).summary(month, endpoint_id)
    except ValueError as exc:
        _raise_cost_http_error(exc)


@router.post("/collect/daily")
def cost_collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    parsed = parse_cost_day(day)
    try:
        return AdminCostService(db).collect_daily(parsed, current_user)
    except ValueError as exc:
        _raise_cost_http_error(exc)


@router.get("/subjects", response_model=CostSubjectsResponse)
def cost_subjects(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    subject_type: str = Query("account", alias="type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> CostSubjectsResponse:
    try:
        return AdminCostService(db).list_subjects(
            month,
            endpoint_id,
            subject_type,
            page,
            page_size,
            sort_by,
            sort_dir,
        )
    except ValueError as exc:
        _raise_cost_http_error(exc)


@router.get("/subject/{subject_type}/{subject_id}", response_model=CostSubjectDetail)
def cost_subject_detail(
    subject_type: str,
    subject_id: int,
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> CostSubjectDetail:
    try:
        return AdminCostService(db).subject_detail(month, endpoint_id, subject_type, subject_id)
    except ValueError as exc:
        _raise_cost_http_error(exc)


@router.get("/export.csv")
def cost_export_csv(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = AdminCostService(db).export_csv(month, endpoint_id)
    except ValueError as exc:
        _raise_cost_http_error(exc)
    headers = {"Content-Disposition": build_attachment_content_disposition(filename)}
    return Response(content=payload, media_type="text/csv", headers=headers)
