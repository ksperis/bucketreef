# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operation import OperationSkippedResponse
from app.models.user_notification import UserNotificationPurgeResponse
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.data_retention_service import DataRetentionService
from app.services.operation_lease_service import (
    USER_NOTIFICATIONS_PURGE_OPERATION,
    default_operation_lease_ttl_seconds,
)


router = APIRouter(
    prefix="/internal/notifications",
    tags=["internal-user-notifications"],
)


@router.post(
    "/purge",
    response_model=UserNotificationPurgeResponse | OperationSkippedResponse,
)
def purge_user_notifications(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> UserNotificationPurgeResponse | OperationSkippedResponse:
    return run_internal_leased_operation(
        db,
        USER_NOTIFICATIONS_PURGE_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        work=lambda: _purge_user_notifications(db),
    )


def _purge_user_notifications(db: Session) -> UserNotificationPurgeResponse:
    result = DataRetentionService(db).purge_user_notifications()
    return UserNotificationPurgeResponse(
        status="completed",
        user_notifications=result["user_notifications"],
    )
