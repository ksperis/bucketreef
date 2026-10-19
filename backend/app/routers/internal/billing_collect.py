# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.billing_common import parse_billing_day
from app.routers.dependencies import require_internal_cron_token
from app.services.app_settings_service import load_app_settings, load_app_settings_for_db
from app.services.billing_collection_service import BillingCollector
from app.services.billing_statement_automation_service import BillingStatementAutomationService
from app.services.operation_lease_service import (
    OperationLeaseService,
    billing_daily_operation_name,
    billing_operation_lease_ttl_seconds,
    billing_statement_monthly_operation_name,
)
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(prefix="/internal/billing", tags=["internal-billing"])


@router.post("/collect/daily")
def collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    parsed = parse_billing_day(day)
    operation_name = billing_daily_operation_name(parsed.isoformat())
    if not load_app_settings().general.billing_enabled:
        return {"status": "skipped", "reason": "feature_disabled", "operation": operation_name}
    with OperationLeaseService(db).hold(
        operation_name,
        ttl_seconds=billing_operation_lease_ttl_seconds(),
        lease_context={"source": "internal", "day": parsed.isoformat()},
    ) as lease:
        if lease is None:
            return {"status": "skipped", "reason": "already_running", "operation": operation_name}
        collector = BillingCollector(db)
        try:
            return collector.collect_daily(parsed)
        except ValueError as exc:
            raise_bad_request_from_value_error(exc)


@router.post("/statements/monthly")
def run_monthly_statements(
    month: str | None = Query(default=None, description="Optional completed month YYYY-MM for an idempotent retry"),
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    app_settings = load_app_settings_for_db(db)
    if not app_settings.general.billing_enabled:
        return {"status": "skipped", "reason": "feature_disabled"}
    automation = BillingStatementAutomationService(db)
    try:
        target_month, trigger_source, skip_reason = automation.target_month(
            app_settings.billing_automation,
            requested_month=month,
        )
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    if target_month is None:
        return {"status": "skipped", "reason": skip_reason}
    operation_name = billing_statement_monthly_operation_name(target_month)
    with OperationLeaseService(db).hold(
        operation_name,
        ttl_seconds=billing_operation_lease_ttl_seconds(),
        lease_context={"source": "internal", "month": target_month, "trigger": trigger_source},
    ) as lease:
        if lease is None:
            return {"status": "skipped", "reason": "already_running", "operation": operation_name}
        if trigger_source == "scheduled" and automation.has_completed_scheduled_run(
            month=target_month,
            mode=app_settings.billing_automation.mode,
        ):
            return {
                "status": "skipped",
                "reason": "already_completed",
                "operation": operation_name,
                "month": target_month,
            }
        try:
            return automation.run(
                month=target_month,
                settings=app_settings.billing_automation,
                trigger_source=trigger_source,
            ).model_dump(mode="json")
        except ValueError as exc:
            raise_bad_request_from_value_error(exc)
