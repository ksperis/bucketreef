# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import BillingDisabledError
from app.db import User
from app.models.billing import (
    BillingAnalysisPreview,
    BillingEntityAdminItem,
    BillingEntityGroupAdminItem,
    BillingEntityGroupPayload,
    BillingEntityPayload,
    BillingEntityResolutionResult,
    BillingEntitySubjectReference,
    BillingFinalizedPeriodAggregation,
    BillingRateCardAdminItem,
    BillingRateCardPayload,
    BillingRateCardVersionCreate,
    BillingStatementGenerationRequest,
    BillingStatementGenerationResult,
    BillingStatementItem,
    BillingSubjectDetail,
    BillingSubjectsResponse,
    BillingSummary,
)
from app.routers.billing_common import parse_billing_day
from app.routers.dependencies import get_audit_service, get_current_super_admin
from app.services.admin_billing_service import AdminBillingService
from app.services.audit_service import AuditService
from app.services.billing_rate_card_service import (
    BillingRateCardConflictError,
    BillingRateCardImmutableError,
    BillingRateCardNotFoundError,
    BillingRateCardService,
)
from app.services.billing_entity_service import (
    BillingEntityConflictError,
    BillingEntityNotFoundError,
    BillingEntityService,
)
from app.services.billing_entity_group_service import (
    BillingEntityGroupConflictError,
    BillingEntityGroupNotFoundError,
    BillingEntityGroupService,
)
from app.services.billing_period_service import (
    BillingFinalizedPeriodService,
    BillingPeriodScopeNotFoundError,
)
from app.services.billing_statement_service import (
    BillingStatementBlockedError,
    BillingStatementImmutableError,
    BillingStatementNotFoundError,
    BillingStatementService,
    BillingStatementStaleError,
)
from app.utils.http_errors import raise_http_error_from_value_error
from app.utils.http_headers import build_attachment_content_disposition

router = APIRouter(prefix="/admin/billing", tags=["admin-billing"])


def _raise_billing_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, BillingDisabledError):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Billing is disabled") from exc
    raise_http_error_from_value_error(exc)


def _billing_statement_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, (BillingStatementNotFoundError, BillingPeriodScopeNotFoundError)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(
        exc,
        (
            BillingStatementBlockedError,
            BillingStatementImmutableError,
            BillingStatementStaleError,
        ),
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise_http_error_from_value_error(exc)


@router.get("/summary", response_model=BillingSummary)
def billing_summary(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int | None = Query(None),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSummary:
    try:
        return AdminBillingService(db).summary(month, endpoint_id)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/analysis", response_model=BillingAnalysisPreview)
def billing_analysis(
    month: str = Query(..., description="YYYY-MM"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingAnalysisPreview:
    try:
        return AdminBillingService(db).analysis(month)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/statements", response_model=list[BillingStatementItem])
def billing_statements(
    month: str | None = Query(None, description="YYYY-MM"),
    billing_entity_id: int | None = Query(None, ge=1),
    statement_status: str | None = Query(None, alias="status"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> list[BillingStatementItem]:
    try:
        return BillingStatementService(db).list(
            month=month,
            billing_entity_id=billing_entity_id,
            status=statement_status,
        )
    except ValueError as exc:
        _billing_statement_http_error(exc)


@router.get("/finalized-period", response_model=BillingFinalizedPeriodAggregation)
def billing_finalized_period(
    scope_type: str = Query(...),
    scope_id: int = Query(..., ge=1),
    start_month: str = Query(..., description="YYYY-MM"),
    end_month: str = Query(..., description="YYYY-MM"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingFinalizedPeriodAggregation:
    try:
        return BillingFinalizedPeriodService(db).aggregate(
            scope_type=scope_type,
            scope_id=scope_id,
            start_month=start_month,
            end_month=end_month,
        )
    except ValueError as exc:
        _billing_statement_http_error(exc)


@router.post("/statements/generate", response_model=BillingStatementGenerationResult)
def generate_billing_statements(
    payload: BillingStatementGenerationRequest,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingStatementGenerationResult:
    try:
        result = BillingStatementService(db).generate(
            month=payload.month,
            billing_entity_id=payload.billing_entity_id,
            regenerate=payload.regenerate,
        )
    except ValueError as exc:
        _billing_statement_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_statement.regenerate" if payload.regenerate else "billing_statement.generate",
        entity_type="billing_entity",
        entity_id=str(payload.billing_entity_id),
        metadata={
            "month": result.month,
            "statement_ids": [item.id for item in result.statements],
            "statement_public_ids": [item.public_id for item in result.statements],
            "currencies": [item.currency for item in result.statements],
            "revisions": [item.revision for item in result.statements],
            "blockers": result.blockers,
        },
    )
    return result


@router.get("/statements/{statement_id}", response_model=BillingStatementItem)
def billing_statement(
    statement_id: int,
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingStatementItem:
    try:
        return BillingStatementService(db).get(statement_id)
    except ValueError as exc:
        _billing_statement_http_error(exc)


@router.get("/statements/{statement_id}/export.csv")
def billing_statement_export_csv(
    statement_id: int,
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = BillingStatementService(db).export_csv(statement_id)
    except ValueError as exc:
        _billing_statement_http_error(exc)
    return Response(
        content=payload,
        media_type="text/csv",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )


@router.get("/statements/{statement_id}/export.json")
def billing_statement_export_json(
    statement_id: int,
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = BillingStatementService(db).export_json(statement_id)
    except ValueError as exc:
        _billing_statement_http_error(exc)
    return Response(
        content=payload,
        media_type="application/json",
        headers={"Content-Disposition": build_attachment_content_disposition(filename)},
    )


@router.post("/statements/{statement_id}/finalize", response_model=BillingStatementItem)
def finalize_billing_statement(
    statement_id: int,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingStatementItem:
    try:
        item = BillingStatementService(db).finalize(statement_id, actor=current_user)
    except ValueError as exc:
        _billing_statement_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_statement.finalize",
        entity_type="billing_statement",
        entity_id=str(item.id),
        metadata={
            "public_id": item.public_id,
            "billing_entity_id": item.billing_entity_id,
            "period_start": item.period_start.isoformat(),
            "currency": item.currency,
            "total": str(item.total),
            "revision": item.revision,
        },
    )
    return item


@router.post("/collect/daily")
def billing_collect_daily(
    day: str = Query(..., description="UTC day YYYY-MM-DD"),
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> dict:
    parsed = parse_billing_day(day)
    try:
        return AdminBillingService(db).collect_daily(parsed, current_user)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/subjects", response_model=BillingSubjectsResponse)
def billing_subjects(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    subject_type: str = Query("account", alias="type"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSubjectsResponse:
    try:
        return AdminBillingService(db).list_subjects(
            month,
            endpoint_id,
            subject_type,
            page,
            page_size,
            sort_by,
            sort_dir,
        )
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/subject/{subject_type}/{subject_id}", response_model=BillingSubjectDetail)
def billing_subject_detail(
    subject_type: str,
    subject_id: int,
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingSubjectDetail:
    try:
        return AdminBillingService(db).subject_detail(month, endpoint_id, subject_type, subject_id)
    except ValueError as exc:
        _raise_billing_http_error(exc)


@router.get("/export.csv")
def billing_export_csv(
    month: str = Query(..., description="YYYY-MM"),
    endpoint_id: int = Query(...),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> Response:
    try:
        filename, payload = AdminBillingService(db).export_csv(month, endpoint_id)
    except ValueError as exc:
        _raise_billing_http_error(exc)
    headers = {"Content-Disposition": build_attachment_content_disposition(filename)}
    return Response(content=payload, media_type="text/csv", headers=headers)



def _rate_card_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, BillingRateCardNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, (BillingRateCardConflictError, BillingRateCardImmutableError)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise_http_error_from_value_error(exc)


def _rate_card_audit_metadata(item: BillingRateCardAdminItem) -> dict:
    return {
        "rate_card_id": item.id,
        "name": item.name,
        "scope": "endpoint" if item.storage_endpoint_id is not None else "global",
        "storage_endpoint_id": item.storage_endpoint_id,
        "currency": item.currency,
        "storage_charge_basis": item.storage_charge_basis,
        "effective_from": item.effective_from.isoformat(),
        "effective_to": item.effective_to.isoformat() if item.effective_to else None,
        "prices": {
            "storage_gb_month_price": item.storage_gb_month_price,
            "egress_gb_price": item.egress_gb_price,
            "ingress_gb_price": item.ingress_gb_price,
            "requests_per_1000_price": item.requests_per_1000_price,
        },
    }


def _billing_entity_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, BillingEntityNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, BillingEntityConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise_http_error_from_value_error(exc)


def _billing_entity_audit_metadata(item: BillingEntityAdminItem) -> dict:
    return {
        "billing_entity_id": item.id,
        "name": item.name,
        "code": item.code,
        "external_id": item.external_id,
        "subject_type": item.subject_type,
        "active": item.active,
        "include_tag_ids": [tag.id for tag in item.include_tags],
        "explicit_include_ids": [subject.subject_id for subject in item.explicit_includes],
        "explicit_exclude_ids": [subject.subject_id for subject in item.explicit_excludes],
        "rate_assignments": [
            {
                "rate_plan_id": assignment.rate_plan_id,
                "effective_from": assignment.effective_from.isoformat(),
                "effective_to": assignment.effective_to.isoformat() if assignment.effective_to else None,
            }
            for assignment in item.rate_assignments
        ],
    }


def _billing_entity_group_http_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, BillingEntityGroupNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, BillingEntityGroupConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    raise_http_error_from_value_error(exc)


def _billing_entity_group_audit_metadata(item: BillingEntityGroupAdminItem) -> dict:
    return {
        "billing_entity_group_id": item.id,
        "name": item.name,
        "code": item.code,
        "external_id": item.external_id,
        "active": item.active,
        "memberships": [
            {
                "billing_entity_id": membership.billing_entity_id,
                "effective_from": membership.effective_from.isoformat(),
                "effective_to": membership.effective_to.isoformat() if membership.effective_to else None,
            }
            for membership in item.memberships
        ],
    }


@router.get("/entity-subjects", response_model=list[BillingEntitySubjectReference])
def billing_entity_subjects(
    subject_type: str = Query(...),
    search: str = Query(""),
    limit: int = Query(20, ge=1, le=100),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> list[BillingEntitySubjectReference]:
    try:
        return BillingEntityService(db).search_subjects(
            subject_type=subject_type,
            search=search,
            limit=limit,
        )
    except ValueError as exc:
        _billing_entity_http_error(exc)


@router.post("/entities/preview", response_model=BillingEntityResolutionResult)
def preview_billing_entity(
    payload: BillingEntityPayload,
    entity_id: int | None = Query(None, ge=1),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingEntityResolutionResult:
    try:
        return BillingEntityService(db).preview(payload, entity_id=entity_id)
    except ValueError as exc:
        _billing_entity_http_error(exc)


@router.get("/entities", response_model=list[BillingEntityAdminItem])
def billing_entities(
    search: str = Query(""),
    include_inactive: bool = Query(True),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> list[BillingEntityAdminItem]:
    return BillingEntityService(db).list(search=search, include_inactive=include_inactive)


@router.post("/entities", response_model=BillingEntityAdminItem, status_code=status.HTTP_201_CREATED)
def create_billing_entity(
    payload: BillingEntityPayload,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingEntityAdminItem:
    try:
        item = BillingEntityService(db).create(payload)
    except ValueError as exc:
        _billing_entity_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_entity.create",
        entity_type="billing_entity",
        entity_id=str(item.id),
        metadata=_billing_entity_audit_metadata(item),
    )
    return item


@router.get("/entities/{entity_id}", response_model=BillingEntityAdminItem)
def billing_entity(
    entity_id: int,
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingEntityAdminItem:
    try:
        return BillingEntityService(db).get(entity_id)
    except ValueError as exc:
        _billing_entity_http_error(exc)


@router.put("/entities/{entity_id}", response_model=BillingEntityAdminItem)
def update_billing_entity(
    entity_id: int,
    payload: BillingEntityPayload,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingEntityAdminItem:
    service = BillingEntityService(db)
    try:
        before = service.get(entity_id)
        item = service.update(entity_id, payload)
    except ValueError as exc:
        _billing_entity_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_entity.update",
        entity_type="billing_entity",
        entity_id=str(item.id),
        metadata={
            "before": _billing_entity_audit_metadata(before),
            "after": _billing_entity_audit_metadata(item),
        },
    )
    return item


@router.post("/entities/{entity_id}/deactivate", response_model=BillingEntityAdminItem)
def deactivate_billing_entity(
    entity_id: int,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingEntityAdminItem:
    service = BillingEntityService(db)
    try:
        before = service.get(entity_id)
        item = service.deactivate(entity_id)
    except ValueError as exc:
        _billing_entity_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_entity.deactivate",
        entity_type="billing_entity",
        entity_id=str(item.id),
        metadata={
            "before": _billing_entity_audit_metadata(before),
            "after": _billing_entity_audit_metadata(item),
        },
    )
    return item


@router.get("/groups", response_model=list[BillingEntityGroupAdminItem])
def billing_entity_groups(
    search: str = Query(""),
    include_inactive: bool = Query(True),
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> list[BillingEntityGroupAdminItem]:
    return BillingEntityGroupService(db).list(search=search, include_inactive=include_inactive)


@router.post("/groups", response_model=BillingEntityGroupAdminItem, status_code=status.HTTP_201_CREATED)
def create_billing_entity_group(
    payload: BillingEntityGroupPayload,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingEntityGroupAdminItem:
    try:
        item = BillingEntityGroupService(db).create(payload)
    except ValueError as exc:
        _billing_entity_group_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_entity_group.create",
        entity_type="billing_entity_group",
        entity_id=str(item.id),
        metadata=_billing_entity_group_audit_metadata(item),
    )
    return item


@router.get("/groups/{group_id}", response_model=BillingEntityGroupAdminItem)
def billing_entity_group(
    group_id: int,
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingEntityGroupAdminItem:
    try:
        return BillingEntityGroupService(db).get(group_id)
    except ValueError as exc:
        _billing_entity_group_http_error(exc)


@router.put("/groups/{group_id}", response_model=BillingEntityGroupAdminItem)
def update_billing_entity_group(
    group_id: int,
    payload: BillingEntityGroupPayload,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingEntityGroupAdminItem:
    service = BillingEntityGroupService(db)
    try:
        before = service.get(group_id)
        item = service.update(group_id, payload)
    except ValueError as exc:
        _billing_entity_group_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_entity_group.update",
        entity_type="billing_entity_group",
        entity_id=str(item.id),
        metadata={
            "before": _billing_entity_group_audit_metadata(before),
            "after": _billing_entity_group_audit_metadata(item),
        },
    )
    return item


@router.post("/groups/{group_id}/deactivate", response_model=BillingEntityGroupAdminItem)
def deactivate_billing_entity_group(
    group_id: int,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingEntityGroupAdminItem:
    service = BillingEntityGroupService(db)
    try:
        before = service.get(group_id)
        item = service.deactivate(group_id)
    except ValueError as exc:
        _billing_entity_group_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_entity_group.deactivate",
        entity_type="billing_entity_group",
        entity_id=str(item.id),
        metadata={
            "before": _billing_entity_group_audit_metadata(before),
            "after": _billing_entity_group_audit_metadata(item),
        },
    )
    return item


@router.get("/rate-cards", response_model=list[BillingRateCardAdminItem])
def billing_rate_cards(
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> list[BillingRateCardAdminItem]:
    return BillingRateCardService(db).list()


@router.get("/rate-cards/{rate_card_id}", response_model=BillingRateCardAdminItem)
def billing_rate_card(
    rate_card_id: int,
    _: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
) -> BillingRateCardAdminItem:
    try:
        return BillingRateCardService(db).get(rate_card_id)
    except ValueError as exc:
        _rate_card_http_error(exc)


@router.post("/rate-cards", response_model=BillingRateCardAdminItem, status_code=status.HTTP_201_CREATED)
def create_billing_rate_card(
    payload: BillingRateCardPayload,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingRateCardAdminItem:
    try:
        item = BillingRateCardService(db).create(payload)
    except ValueError as exc:
        _rate_card_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_rate_card.create",
        entity_type="billing_rate_card",
        entity_id=str(item.id),
        metadata=_rate_card_audit_metadata(item),
    )
    return item


@router.put("/rate-cards/{rate_card_id}", response_model=BillingRateCardAdminItem)
def update_billing_rate_card(
    rate_card_id: int,
    payload: BillingRateCardPayload,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingRateCardAdminItem:
    service = BillingRateCardService(db)
    try:
        before = service.get(rate_card_id)
        item = service.update(rate_card_id, payload)
    except ValueError as exc:
        _rate_card_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_rate_card.update",
        entity_type="billing_rate_card",
        entity_id=str(item.id),
        metadata={"before": _rate_card_audit_metadata(before), "after": _rate_card_audit_metadata(item)},
    )
    return item


@router.post("/rate-cards/{rate_card_id}/versions", response_model=BillingRateCardAdminItem, status_code=status.HTTP_201_CREATED)
def create_billing_rate_card_version(
    rate_card_id: int,
    payload: BillingRateCardVersionCreate,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> BillingRateCardAdminItem:
    service = BillingRateCardService(db)
    try:
        source = service.get(rate_card_id)
        item = service.create_version(rate_card_id, payload)
    except ValueError as exc:
        _rate_card_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_rate_card.version_create",
        entity_type="billing_rate_card",
        entity_id=str(item.id),
        metadata={"source": _rate_card_audit_metadata(source), "version": _rate_card_audit_metadata(item)},
    )
    return item


@router.delete("/rate-cards/{rate_card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_billing_rate_card(
    rate_card_id: int,
    current_user: User = Depends(get_current_super_admin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> Response:
    service = BillingRateCardService(db)
    try:
        item = service.get(rate_card_id)
        service.delete(rate_card_id)
    except ValueError as exc:
        _rate_card_http_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="billing_rate_card.delete",
        entity_type="billing_rate_card",
        entity_id=str(rate_card_id),
        metadata=_rate_card_audit_metadata(item),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
