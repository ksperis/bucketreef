# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal cost endpoint."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_context import AccountAccess
from app.models.cost import CostSubjectDetail
from app.routers.dependencies import get_portal_account_access
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.cost_service import CostService
from app.services.portal_service import PortalService
from app.utils.http_errors import raise_http_error_from_value_error

router = APIRouter()


@router.get("/cost/me", response_model=CostSubjectDetail)
def portal_cost_me(
    month: str = Query(..., description="YYYY-MM"),
    access: AccountAccess = Depends(get_portal_account_access),
    db: Session = Depends(get_db),
) -> CostSubjectDetail:
    app_settings = load_app_settings_for_db_readonly(db)
    if not app_settings.general.cost_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cost is disabled")
    actor = access.actor
    if not isinstance(actor, User):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Portal endpoints require a UI user")
    account = access.account
    if not PortalService(db).get_effective_portal_settings(account).cost_estimation_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cost estimation is disabled for this Portal project")
    service = CostService(db)
    try:
        return service.subject_detail(month, account.storage_endpoint_id, "account", account.id)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
