# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from functools import partial
from typing import Any

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.db import User
from app.models.bucket_purge import BucketPurgeProgress, BucketPurgeResult
from app.routers.sse_worker import stream_status_operation
from app.services.bucket_purge_audit import BucketPurgeAuditLifecycle, record_bucket_purge_audit
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.s3_execution_context import S3ExecutionContext


def stream_bucket_purge(
    request: Request,
    *,
    run_purge: Callable[[Callable[[BucketPurgeProgress], None], Callable[[], None]], BucketPurgeResult],
    logger: logging.Logger,
    failure_message: str,
    on_start: Callable[[str], None] | None = None,
    on_result: Callable[[str, BucketPurgeResult], None] | None = None,
    on_cancel: Callable[[str], None] | None = None,
    on_error: Callable[[str, str], None] | None = None,
) -> StreamingResponse:
    return stream_status_operation(
        request,
        run_operation=run_purge,
        cancelled_error=BucketPurgeCancelled,
        logger=logger,
        operation="bucket_purge",
        failure_message=failure_message,
        on_start=on_start,
        on_result=on_result,
        on_cancel=on_cancel,
        on_error=on_error,
    )


def stream_audited_bucket_purge(
    request: Request,
    *,
    user: User,
    scope: str,
    base_metadata: Mapping[str, Any],
    run_purge: Callable[[Callable[[BucketPurgeProgress], None], Callable[[], None]], BucketPurgeResult],
    logger: logging.Logger,
    failure_message: str,
    execution_context: S3ExecutionContext | None = None,
) -> StreamingResponse:
    audit = BucketPurgeAuditLifecycle(
        record=partial(
            record_bucket_purge_audit,
            user_id=int(user.id),
            user_email=str(user.email),
            user_role=str(user.role),
            scope=scope,
            execution_context=execution_context,
        ),
        base_metadata=base_metadata,
    )
    return stream_bucket_purge(
        request,
        run_purge=run_purge,
        logger=logger,
        failure_message=failure_message,
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
    )
