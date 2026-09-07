# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import HTTPException, status

from app.models.account_capabilities import AccountCapabilities
from app.services.s3_execution_context import S3ExecutionContext


def require_manager_capabilities(account: S3ExecutionContext) -> AccountCapabilities:
    if not isinstance(account, S3ExecutionContext) or not isinstance(account.manager_capabilities, AccountCapabilities):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account context unavailable")
    return account.manager_capabilities


def require_bucket_management_context(account: S3ExecutionContext) -> None:
    capabilities = require_manager_capabilities(account)
    if not capabilities.can_manage_buckets:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bucket management is not allowed for this context",
        )
