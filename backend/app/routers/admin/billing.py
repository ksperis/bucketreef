# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import BillingDisabledError
from app.db import User
from app.models.billing import BillingSubjectDetail, BillingSubjectsResponse, BillingSummary
from app.routers.billing_common import parse_billing_day
from app.routers.dependencies import get_current_super_admin
from app.services.admin_billing_service import AdminBillingService
from app.utils.http_errors import raise_http_error_from_value_error
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


def _raise_billing_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, BillingDisabledError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    raise_http_error_from_value_error(exc)


@router.get("/summary", response_model=BillingSummary)
def billing_summary(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int | None = Query(None),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSummary:
    try:
        return AdminBillingService(db).summary(month, endpoint_id)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.post("/collect/daily")
def billing_collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    parsed = parse_billing_day(day)
    try:
        return AdminBillingService(db).collect_daily(parsed, current_user)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/subjects", response_model=BillingSubjectsResponse)
def billing_subjects(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    subject_type: str = Query("account", alias="type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSubjectsResponse:
    try:
        return AdminBillingService(db).list_subjects(
            month,
            endpoint_id,
            subject_type,
            page,
            page_size,
            sort_by,
            sort_dir,
        )
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/subject/{subject_type}/{subject_id}", response_model=BillingSubjectDetail)
def billing_subject_detail(
    subject_type: str,
    subject_id: int,
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSubjectDetail:
    try:
        return AdminBillingService(db).subject_detail(month, endpoint_id, subject_type, subject_id)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/export.csv")
def billing_export_csv(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = AdminBillingService(db).export_csv(month, endpoint_id)
    except ValueError as exc:
        _raise_billing_http_error(exc)
    headers = {"Content-Disposition": build_attachment_content_disposition(filename)}
    return Response(content=payload, media_type="text/csv", headers=headers)
