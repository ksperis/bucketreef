# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Manager cost estimation endpoint for persisted RGW subjects."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account, S3User
from app.models.cost import CostSubjectDetail
from app.models.feature_policy import resolve_feature_policy
from app.routers.dependencies import get_s3_execution_context
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.cost_service import CostService
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_http_error_from_value_error


router = APIRouter(prefix="/manager/cost", tags=["manager-cost"])


@router.get("/me", response_model=CostSubjectDetail)
def manager_cost_me(
    month: str = Query(..., description="YYYY-MM"),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    db: Session = Depends(get_db),
) -> CostSubjectDetail:
    settings = load_app_settings_for_db_readonly(db)
    if not settings.general.cost_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cost is disabled")

    subject_type: str
    subject_id: int
    resource: S3Account | S3User | None
    if context.context_kind == "account" and isinstance(context.id, int):
        subject_type = "account"
        subject_id = context.id
        resource = context.source_account or db.get(S3Account, subject_id)
    elif context.context_kind == "s3_user" and context.s3_user_id is not None:
        subject_type = "s3_user"
        subject_id = context.s3_user_id
        resource = context.source_s3_user or db.get(S3User, subject_id)
    else:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cost estimation is unavailable for this Manager context",
        )

    if resource is None or context.storage_endpoint_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Cost estimation subject was not found",
        )
    state = resolve_feature_policy(
        settings.manager.feature_policies.cost_estimation,
        resource.allow_cost_estimation,
    )
    if not state.enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cost estimation is disabled for this Manager context",
        )

    try:
        return CostService(db).subject_detail(
            month,
            context.storage_endpoint_id,
            subject_type,
            subject_id,
        )
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
