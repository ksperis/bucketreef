# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.app_settings_service import load_app_settings
from app.services.healthcheck_service import HealthCheckService
from app.services.operation_lease_service import (
    HEALTHCHECK_RUN_OPERATION,
    OperationLeaseService,
    default_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/healthchecks", tags=["internal-healthchecks"])


@router.post("/run")
def run_healthchecks(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    if not load_app_settings().general.endpoint_status_enabled:
        return {"status": "skipped", "reason": "feature_disabled", "operation": HEALTHCHECK_RUN_OPERATION}
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        HEALTHCHECK_RUN_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    )
    if lease is None:
        return {"status": "skipped", "reason": "already_running", "operation": HEALTHCHECK_RUN_OPERATION}
    service = HealthCheckService(db)
    try:
        return service.run_checks()
    except ValueError as exc:
        db.rollback()
        raise_bad_request_from_value_error(exc)
    finally:
        lease_service.release(lease)
