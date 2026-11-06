# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Admin effective-access audit endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_audit import (
    AccessAuditFilters,
    AccessAuditListingRequest,
    PaginatedAccessAuditResponse,
)
from app.routers.dependencies import get_current_ui_admin
from app.services.access_audit_service import AccessAuditService
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter(prefix="/admin/access-audit", tags=["admin-access-audit"])


@router.get("/export.csv")
def export_access_audit_csv(
    filters: Annotated[AccessAuditFilters, Query()],
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> Response:
    filename, payload = AccessAuditService(db).export_csv(filters)
    return Response(
        content=payload,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )


@router.get("", response_model=PaginatedAccessAuditResponse)
def list_access_audit(
    query: Annotated[AccessAuditListingRequest, Query()],
    _: User = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> PaginatedAccessAuditResponse:
    return AccessAuditService(db).paginate(query)
