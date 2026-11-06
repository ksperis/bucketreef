# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.healthcheck import EndpointHealthRunResponse
from app.models.operation import OperationSkippedResponse
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.app_settings_service import load_app_settings_for_db
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import (
    HEALTHCHECK_RUN_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/healthchecks", tags=["internal-healthchecks"])


@router.post("/run", response_model=EndpointHealthRunResponse | OperationSkippedResponse)
def run_healthchecks(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> EndpointHealthRunResponse | OperationSkippedResponse:
    if not load_app_settings_for_db(db).general.endpoint_status_enabled:
        return OperationSkippedResponse(
            status="skipped",
            reason="feature_disabled",
            operation=HEALTHCHECK_RUN_OPERATION,
        )
    return run_internal_leased_operation(
        db,
        HEALTHCHECK_RUN_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        work=lambda: _run_healthchecks(db),
    )


def _run_healthchecks(db: Session) -> EndpointHealthRunResponse:
    try:
        return EndpointHealthRunResponse.model_validate(HealthCheckService(db).run_checks())
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
