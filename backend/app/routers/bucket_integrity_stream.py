# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.models.bucket_integrity import BucketIntegrityCheckProgress, BucketIntegrityCheckResult
from app.routers.sse_worker import stream_status_operation
from app.services.bucket_integrity_service import BucketIntegrityCheckCancelled

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
