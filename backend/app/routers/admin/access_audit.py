# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Admin effective-access audit endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_audit import (
    AccessAuditRightCode,
    AccessAuditScope,
    AccessAuditSourceKind,
    PaginatedAccessAuditResponse,
)
from app.routers.dependencies import get_current_super_admin
from app.services.access_audit_service import AccessAuditFilters, AccessAuditService
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter(prefix="/admin/access-audit", tags=["admin-access-audit"])


def _filters(
    *,
    search: str | None,
    scope: AccessAuditScope | None,
    right: AccessAuditRightCode | None,
    source: AccessAuditSourceKind | None,
    user_id: int | None,
    target_id: int | None,
    sort_by: Literal["user", "scope", "target"],
    sort_dir: Literal["asc", "desc"],
) -> AccessAuditFilters:
    return AccessAuditFilters(
        search=search,
        scope=scope,
        right=right,
        source=source,
        user_id=user_id,
        target_id=target_id,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


@router.get("/export.csv")
def export_access_audit_csv(
    search: str | None = Query(None),
    scope: AccessAuditScope | None = Query(None),
    right: AccessAuditRightCode | None = Query(None),
    source: AccessAuditSourceKind | None = Query(None),
    user_id: int | None = Query(None, ge=1),
    target_id: int | None = Query(None, ge=1),
    sort_by: Literal["user", "scope", "target"] = Query("user"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    filename, payload = AccessAuditService(db).export_csv(
        _filters(
            search=search,
            scope=scope,
            right=right,
            source=source,
            user_id=user_id,
            target_id=target_id,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    )
    return Response(
        content=payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )


@router.get("", response_model=PaginatedAccessAuditResponse)
def list_access_audit(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    scope: AccessAuditScope | None = Query(None),
    right: AccessAuditRightCode | None = Query(None),
    source: AccessAuditSourceKind | None = Query(None),
    user_id: int | None = Query(None, ge=1),
    target_id: int | None = Query(None, ge=1),
    sort_by: Literal["user", "scope", "target"] = Query("user"),
    sort_dir: Literal["asc", "desc"] = Query("asc"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> PaginatedAccessAuditResponse:
    return AccessAuditService(db).paginate(
        _filters(
            search=search,
            scope=scope,
            right=right,
            source=source,
            user_id=user_id,
            target_id=target_id,
            sort_by=sort_by,
            sort_dir=sort_dir,
        ),
        page=page,
        page_size=page_size,
    )
