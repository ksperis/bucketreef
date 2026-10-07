# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.access_key_expiration_service import AccessKeyExpirationService
from app.services.operation_lease_service import (
    ACCESS_KEY_EXPIRATION_RUN_OPERATION,
    OperationLeaseService,
    default_operation_lease_ttl_seconds,
)

router = APIRouter(prefix="/internal/access-key-expirations", tags=["internal-access-key-expirations"])


@router.post("/run")
def run_access_key_expirations(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict:
    lease_service = OperationLeaseService(db)
    lease = lease_service.acquire(
        ACCESS_KEY_EXPIRATION_RUN_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        lease_context={"source": "internal"},
    )
    if lease is None:
        return {
            "status": "skipped",
            "reason": "already_running",
            "operation": ACCESS_KEY_EXPIRATION_RUN_OPERATION,
        }
    try:
        return AccessKeyExpirationService(db).run_due()
    finally:
        lease_service.release(lease)
