# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operation import OperationSkippedResponse
from app.models.quota_monitoring import UsageHistoryRunResult
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.quota_monitoring_service import QuotaMonitoringService
from app.services.operation_lease_service import (
    USAGE_HISTORY_COLLECT_OPERATION,
    default_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/usage-history", tags=["internal-usage-history"])


@router.post("/collect", response_model=UsageHistoryRunResult | OperationSkippedResponse)
def collect_usage_history(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> UsageHistoryRunResult | OperationSkippedResponse:
    return run_internal_leased_operation(
        db,
        USAGE_HISTORY_COLLECT_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        work=lambda: _collect_usage_history(db),
    )


def _collect_usage_history(db: Session) -> UsageHistoryRunResult:
    try:
        result = QuotaMonitoringService(db).collect_usage_history()
        return UsageHistoryRunResult.model_validate(
            {field: result[field] for field in UsageHistoryRunResult.model_fields}
        )
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
