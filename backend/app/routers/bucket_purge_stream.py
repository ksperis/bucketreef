# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections.abc import Callable

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.models.bucket_purge import BucketPurgeProgress, BucketPurgeResult
from app.routers.sse_worker import stream_status_operation
from app.services.bucket_purge_service import BucketPurgeCancelled


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
