# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import BillingDisabledError
from app.db import User
from app.models.billing_integration import (
    BillingIntegrationEntityV1,
    BillingIntegrationGroupV1,
    BillingIntegrationPeriodV1,
    BillingIntegrationStatementDetailV1,
    BillingIntegrationStatementPageV1,
)
from app.routers.dependencies import get_current_api_user
from app.services.billing_integration_service import (
    BillingIntegrationNotFoundError,
    BillingIntegrationService,
)
from app.services.billing_period_service import BillingPeriodScopeNotFoundError
from app.utils.http_headers import build_attachment_content_disposition


router = APIRouter(
    prefix="/integrations/billing/v1",
    tags=["billing-integration-v1"],
)


def _integration_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, BillingDisabledError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Billing is disabled") from exc
    if isinstance(exc, (BillingIntegrationNotFoundError, BillingPeriodScopeNotFoundError)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/entities", response_model=list[BillingIntegrationEntityV1])
def billing_entities(
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> list[BillingIntegrationEntityV1]:
    try:
        return BillingIntegrationService(db).list_entities()
    except ValueError as exc:
        _integration_error(exc)


@router.get("/groups", response_model=list[BillingIntegrationGroupV1])
def billing_groups(
    month: str | None = Query(default=None, description="Optional effective month YYYY-MM"),
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> list[BillingIntegrationGroupV1]:
    try:
        return BillingIntegrationService(db).list_groups(month=month)
    except ValueError as exc:
        _integration_error(exc)


def _period_cost(
    *,
    scope_type: Literal["entity", "group"],
    scope_id: int,
    period: Literal["month", "year", "range"],
    month: str | None,
    year: int | None,
    start_month: str | None,
    end_month: str | None,
    db: Session,
) -> BillingIntegrationPeriodV1:
    try:
        return BillingIntegrationService(db).finalized_period(
            scope_type=scope_type,
            scope_id=scope_id,
            period_type=period,
            month=month,
            year=year,
            start_month=start_month,
            end_month=end_month,
        )
    except ValueError as exc:
        _integration_error(exc)


@router.get("/entities/{entity_id}/costs", response_model=BillingIntegrationPeriodV1)
def billing_entity_costs(
    entity_id: int,
    period: Literal["month", "year", "range"] = Query(...),
    month: str | None = Query(default=None),
    year: int | None = Query(default=None, ge=1, le=9999),
    start_month: str | None = Query(default=None),
    end_month: str | None = Query(default=None),
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> BillingIntegrationPeriodV1:
    return _period_cost(
        scope_type="entity",
        scope_id=entity_id,
        period=period,
        month=month,
        year=year,
        start_month=start_month,
        end_month=end_month,
        db=db,
    )


@router.get("/groups/{group_id}/costs", response_model=BillingIntegrationPeriodV1)
def billing_group_costs(
    group_id: int,
    period: Literal["month", "year", "range"] = Query(...),
    month: str | None = Query(default=None),
    year: int | None = Query(default=None, ge=1, le=9999),
    start_month: str | None = Query(default=None),
    end_month: str | None = Query(default=None),
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> BillingIntegrationPeriodV1:
    return _period_cost(
        scope_type="group",
        scope_id=group_id,
        period=period,
        month=month,
        year=year,
        start_month=start_month,
        end_month=end_month,
        db=db,
    )


@router.get("/statements", response_model=BillingIntegrationStatementPageV1)
def billing_statements(
    start_month: str | None = Query(default=None),
    end_month: str | None = Query(default=None),
    billing_entity_id: int | None = Query(default=None, ge=1),
    billing_entity_external_id: str | None = Query(default=None),
    currency: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = Query(default=None),
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> BillingIntegrationStatementPageV1:
    try:
        return BillingIntegrationService(db).list_finalized_statements(
            start_month=start_month,
            end_month=end_month,
            billing_entity_id=billing_entity_id,
            billing_entity_external_id=billing_entity_external_id,
            currency=currency,
            limit=limit,
            cursor=cursor,
        )
    except ValueError as exc:
        _integration_error(exc)


@router.get("/statements/{public_id}", response_model=BillingIntegrationStatementDetailV1)
def billing_statement(
    public_id: str,
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> BillingIntegrationStatementDetailV1:
    try:
        return BillingIntegrationService(db).get_finalized_statement(public_id)
    except ValueError as exc:
        _integration_error(exc)


@router.get("/statements/{public_id}/export.json")
def billing_statement_export_json(
    public_id: str,
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = BillingIntegrationService(db).export_json(public_id)
    except ValueError as exc:
        _integration_error(exc)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )


@router.get("/statements/{public_id}/export.csv")
def billing_statement_export_csv(
    public_id: str,
    _: User = Depends(get_current_api_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = BillingIntegrationService(db).export_csv(public_id)
    except ValueError as exc:
        _integration_error(exc)
    return Response(
        content=payload,
        media_type="text/csv",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )
