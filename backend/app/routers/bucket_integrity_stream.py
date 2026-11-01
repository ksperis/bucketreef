# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Callable

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.models.bucket_integrity import (
    BucketIntegrityCheckProgress,
    BucketIntegrityCheckResult,
    BucketIntegrityRequestOptions,
)
from app.routers.sse_worker import stream_status_operation
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckCancelled,
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)

def stream_bucket_integrity_check(
    request: Request,
    *,
    run_check: Callable[[Callable[[BucketIntegrityCheckProgress], None], Callable[[], None]], BucketIntegrityCheckResult],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    return stream_status_operation(
        request,
        run_operation=run_check,
        cancelled_error=BucketIntegrityCheckCancelled,
        logger=logger,
        operation="bucket_integrity_check",
        failure_message=failure_message,
    )


def stream_resolved_bucket_integrity_check(
    request: Request,
    *,
    payload: BucketIntegrityRequestOptions,
    targets: Sequence[BucketIntegrityResolvedTarget],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    service = BucketIntegrityCheckService()
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        check_mode=payload.check_mode,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    return stream_bucket_integrity_check(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            list(targets),
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message=failure_message,
    )
