# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Sequence

from fastapi import HTTPException, status

from app.models.bucket_operation import BucketOperationTarget
from app.services.s3_execution_context import ResolvedS3BucketTarget, S3ExecutionContext
from app.services.storage_ops_context_resolution import StorageOpsContextRef


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


def resolve_storage_ops_bucket_targets(
    targets: Sequence[BucketOperationTarget],
    *,
    resolver: Callable[[str], S3ExecutionContext],
) -> list[ResolvedS3BucketTarget]:
    resolved_targets: list[ResolvedS3BucketTarget] = []
    for target in targets:
        context = resolver(target.context_id)
        resolved_targets.append(ResolvedS3BucketTarget.from_context(context, target.bucket_name))
    return resolved_targets
