# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException, status

from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_listing_service import StorageOpsContextRef


def resolve_storage_ops_context(
    ref: StorageOpsContextRef,
    *,
    resolver: Callable[[str], S3ExecutionContext],
) -> S3ExecutionContext | None:
    """Resolve a Storage Ops context while skipping revoked or missing entries."""

    try:
        return resolver(ref.context_id)
    except HTTPException as exc:
        if exc.status_code in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
            return None
        raise
