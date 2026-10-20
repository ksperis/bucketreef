# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.cost_common import parse_cost_day
from app.routers.dependencies import require_internal_cron_token
from app.services.app_settings_service import load_app_settings
from app.services.cost_collection_service import CostCollector
from app.services.operation_lease_service import (
    OperationLeaseService,
    cost_daily_operation_name,
    cost_operation_lease_ttl_seconds,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/cost", tags=["internal-cost"])


@router.post("/collect/daily")
def collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    parsed = parse_cost_day(day)
    operation_name = cost_daily_operation_name(parsed.isoformat())
    if not load_app_settings().general.cost_enabled:
        return {"status": "skipped", "reason": "feature_disabled", "operation": operation_name}
    with OperationLeaseService(db).hold(
        operation_name,
        ttl_seconds=cost_operation_lease_ttl_seconds(),
        lease_context={"source": "internal", "day": parsed.isoformat()},
    ) as lease:
        if lease is None:
            return {"status": "skipped", "reason": "already_running", "operation": operation_name}
        collector = CostCollector(db)
        try:
            return collector.collect_daily(parsed)
        except ValueError as exc:
            raise_bad_request_from_value_error(exc)
