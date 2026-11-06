# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.db import User
from app.models.audit import AuditLogListingRequest, AuditLogListResponse
from app.routers.dependencies import get_audit_service, get_current_ui_admin
from app.services.audit_service import AuditService

router = APIRouter(prefix="/admin/audit", tags=["admin-audit"])


@router.get("/logs", response_model=AuditLogListResponse)
def list_audit_logs(
    query: Annotated[AuditLogListingRequest, Query()],
    _: User = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuditLogListResponse:
    return audit_service.list_admin_logs_page(query)
