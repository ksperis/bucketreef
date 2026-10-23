# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operation import OperationSkippedResponse
from app.models.quota_monitoring import QuotaMonitoringResult
from app.routers.dependencies import require_internal_cron_token
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.operation_lease_service import (
    OperationLeaseService,
    USAGE_HISTORY_COLLECT_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/usage-history", tags=["internal-usage-history"])


@router.post("/collect", response_model=QuotaMonitoringResult | OperationSkippedResponse)
def collect_usage_history(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> QuotaMonitoringResult | OperationSkippedResponse:
    with OperationLeaseService(db).hold(
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    ) as lease:
        if lease is None:
            return OperationSkippedResponse(
                status="skipped",
                reason="already_running",
                operation=USAGE_HISTORY_COLLECT_OPERATION,
            )
        service = QuotaMonitoringService(db)
        try:
            return QuotaMonitoringResult.model_validate(
                service.run_monitor(include_quota_alerts=False, include_usage_history=True)
            )
        except ValueError as exc:
            raise_bad_request_from_value_error(exc)
