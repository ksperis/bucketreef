# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operation import OperationSkippedResponse
from app.models.quota_monitoring import QuotaAlertRunResult
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.operation_lease_service import (
    QUOTA_MONITOR_ALERTS_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/quota-monitor", tags=["internal-quota-monitor"])


@router.post("/run", response_model=QuotaAlertRunResult | OperationSkippedResponse)
def run_quota_monitor(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> QuotaAlertRunResult | OperationSkippedResponse:
    return run_internal_leased_operation(
        db,
        QUOTA_MONITOR_ALERTS_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        work=lambda: _run_quota_monitor(db),
    )


def _run_quota_monitor(db: Session) -> QuotaAlertRunResult:
    try:
        result = QuotaMonitoringService(db).run_quota_alerts()
        return QuotaAlertRunResult.model_validate(
            {field: result[field] for field in QuotaAlertRunResult.model_fields}
        )
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
