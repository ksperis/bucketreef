# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.cost import CostCollectionResult
from app.models.operation import OperationSkippedResponse
from app.routers.cost_common import parse_cost_day
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.app_settings_service import load_app_settings_for_db
from app.services.cost_collection_service import CostCollector
from app.services.operation_lease_service import (
    cost_daily_operation_name,
    cost_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/cost", tags=["internal-cost"])


@router.post(
    "/collect/daily",
    response_model=CostCollectionResult | OperationSkippedResponse,
)
def collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> CostCollectionResult | OperationSkippedResponse:
    parsed = parse_cost_day(day)
    operation_name = cost_daily_operation_name(parsed.isoformat())
    if not load_app_settings_for_db(db).general.cost_enabled:
        return OperationSkippedResponse(
            status="skipped",
            reason="feature_disabled",
            operation=operation_name,
        )
    return run_internal_leased_operation(
        db,
        operation_name,
        ttl_seconds=cost_operation_lease_ttl_seconds(),
        lease_context={"source": "internal", "day": parsed.isoformat()},
        work=lambda: _collect_daily(db, parsed),
    )


def _collect_daily(db: Session, day: date) -> CostCollectionResult:
    try:
        return CostCollector(db).collect_daily(day)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
