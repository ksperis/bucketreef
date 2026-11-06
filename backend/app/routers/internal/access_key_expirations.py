# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_key_metadata import AccessKeyExpirationRunResult
from app.models.operation import OperationSkippedResponse
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.access_key_expiration_service import AccessKeyExpirationService
from app.services.operation_lease_service import (
    ACCESS_KEY_EXPIRATION_RUN_OPERATION,
    default_operation_lease_ttl_seconds,
)

router = APIRouter(prefix="/internal/access-key-expirations", tags=["internal-access-key-expirations"])


@router.post(
    "/run",
    response_model=AccessKeyExpirationRunResult | OperationSkippedResponse,
)
def run_access_key_expirations(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> AccessKeyExpirationRunResult | OperationSkippedResponse:
    return run_internal_leased_operation(
        db,
        ACCESS_KEY_EXPIRATION_RUN_OPERATION,
        ttl_seconds=default_operation_lease_ttl_seconds(),
        work=lambda: AccessKeyExpirationService(db).run_due(),
    )
