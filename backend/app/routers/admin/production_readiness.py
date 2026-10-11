# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.db import User
from app.models.app_settings import DEFAULT_DOCUMENTATION_BASE_URL, AppSettings
from app.models.production_readiness import (
    ProductionReadinessFinding,
    ProductionReadinessResponse,
)
from app.routers.dependencies import get_current_ui_superadmin
from app.services.app_settings_service import load_app_settings_for_db
from app.services.deployment_checks import (
    readiness_counts,
    readiness_status,
    run_deployment_checks,
)


router = APIRouter(prefix="/admin/production-readiness", tags=["admin-production-readiness"])


def _configured_documentation_url(url: str, app_settings: AppSettings | None) -> str:
    if app_settings is None:
        return url
    canonical_base = DEFAULT_DOCUMENTATION_BASE_URL.rstrip("/")
    if url == canonical_base:
        return app_settings.general.documentation_base_url
    canonical_prefix = f"{canonical_base}/"
    if not url.startswith(canonical_prefix):
        return url
    configured_base = app_settings.general.documentation_base_url.rstrip("/")
    suffix = url[len(canonical_base) :]
    return f"{configured_base}{suffix}" if configured_base else suffix


@router.get("", response_model=ProductionReadinessResponse)
def get_production_readiness(
    _: User = Depends(get_current_ui_superadmin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_db),
) -> ProductionReadinessResponse:
    try:
        app_settings = load_app_settings_for_db(db)
    except Exception:
        app_settings = None
    findings = run_deployment_checks(settings, app_settings=app_settings, db=db)
    return ProductionReadinessResponse(
        environment=settings.app_env,
        profile=settings.deployment_profile,
        status=readiness_status(findings),
        counts=readiness_counts(findings),
        findings=[
            ProductionReadinessFinding(
                code=finding.code,
                label=finding.label,
                result=finding.result,
                severity=finding.severity,
                level=finding.level,
                message=finding.message,
                documentation_url=_configured_documentation_url(
                    finding.documentation_url,
                    app_settings,
                ),
                blocks_startup=finding.blocks_startup,
            )
            for finding in findings
        ],
    )
