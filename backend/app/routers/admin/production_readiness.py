# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.db import User
from app.models.production_readiness import (
    ProductionReadinessFinding,
    ProductionReadinessResponse,
)
from app.routers.dependencies import get_current_ui_superadmin
from app.services.production_hardening import (
    check_production_hardening,
    hardening_counts,
    hardening_finding_label,
    hardening_status,
)


router = APIRouter(prefix="/admin/production-readiness", tags=["admin-production-readiness"])


@router.get("", response_model=ProductionReadinessResponse)
def get_production_readiness(
    _: User = Depends(get_current_ui_superadmin),
    settings: Settings = Depends(get_settings),
) -> ProductionReadinessResponse:
    findings = check_production_hardening(settings)
    return ProductionReadinessResponse(
        profile=settings.deployment_profile,
        status=hardening_status(findings),
        counts=hardening_counts(findings),
        findings=[
            ProductionReadinessFinding(
                code=finding.code,
                label=hardening_finding_label(finding.code),
                level=finding.level,
                message=finding.message,
            )
            for finding in findings
        ],
    )
