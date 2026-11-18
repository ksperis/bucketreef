# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.operation import OperationSkippedResponse
from app.models.retention import AuthSessionPurgeResponse
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.auth_session_service import AuthSessionService
from app.services.operation_lease_service import (
    AUTH_SESSION_RETENTION_OPERATION,
    default_operation_lease_ttl_seconds,
)


router = APIRouter(
    prefix="/internal/auth-sessions",
    tags=["internal-auth-sessions"],
)


@router.post(
    "/purge",
    response_model=AuthSessionPurgeResponse | OperationSkippedResponse,
)
def purge_auth_sessions(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> AuthSessionPurgeResponse | OperationSkippedResponse:
    return run_internal_leased_operation(
        db,
        AUTH_SESSION_RETENTION_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        work=lambda: _purge_auth_sessions(db),
    )


def _purge_auth_sessions(db: Session) -> AuthSessionPurgeResponse:
    service = AuthSessionService(db)
    service.cleanup_expired()
    result = service.purge_inactive()
    return AuthSessionPurgeResponse(
        status="completed",
        auth_sessions=result,
    )
