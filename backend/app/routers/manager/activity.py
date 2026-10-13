# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import S3Account
from app.models.feature_policy import resolve_feature_policy
from app.services.s3_execution_context import S3ExecutionContext
from app.models.manager_activity import ManagerActivityEntry
from app.routers.dependencies import get_account_context, get_audit_service
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.audit_service import AuditService

router = APIRouter(prefix="/manager/activity", tags=["manager-activity"])


@router.get("", response_model=list[ManagerActivityEntry])
def list_manager_activity(
    limit: int = Query(5, ge=1, le=20),
    cursor: int | None = Query(None, ge=1),
    search: str | None = Query(None, max_length=200),
    status: str | None = Query(None, max_length=32),
    account: S3ExecutionContext = Depends(get_account_context),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> list[ManagerActivityEntry]:
    if account.context_kind != "account":
        raise HTTPException(status_code=404, detail="Activity history is available only for RGW Account contexts")
    account_id = account.id if isinstance(account.id, int) and account.id > 0 else None
    if account_id is None:
        raise HTTPException(status_code=404, detail="Activity history is unavailable for this Manager context")

    resource = db.get(S3Account, account_id)
    if resource is None:
        raise HTTPException(status_code=404, detail="RGW Account not found")
    settings = load_app_settings_for_db_readonly(db)
    state = resolve_feature_policy(settings.manager.feature_policies.activity_history, resource.allow_activity_history)
    if not state.enabled:
        raise HTTPException(status_code=403, detail="Activity history is disabled for this RGW Account")

    logs = audit_service.list_logs(
        limit=limit,
        scope="manager",
        account_id=account_id,
        cursor=cursor,
        search=search,
        status=status,
        search_mode="manager_activity",
    )
    return [
        ManagerActivityEntry(
            id=log.id,
            created_at=log.created_at,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            account_id=log.account_id,
            account_name=log.account_name,
            status=log.status,
            user_email=log.user_email,
        )
        for log in logs
    ]
