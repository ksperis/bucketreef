# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Callable

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.core.database import SessionLocal
from app.models.bucket_usage_stats import BucketUsageStatsProgress, BucketUsageStatsResult
from app.routers.sse_worker import stream_status_operation
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsCancelled,
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)

def stream_bucket_usage_stats(
    request: Request,
    *,
    run_check: Callable[[Callable[[BucketUsageStatsProgress], None], Callable[[], None]], BucketUsageStatsResult],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    return stream_status_operation(
        request,
        run_operation=run_check,
        cancelled_error=BucketUsageStatsCancelled,
        logger=logger,
        operation="bucket_usage_stats",
        failure_message=failure_message,
    )


def stream_resolved_bucket_usage_stats(
    request: Request,
    *,
    targets: Sequence[BucketUsageStatsResolvedTarget],
    parallelism: int,
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    service = BucketUsageStatsService(SessionLocal)
    options = BucketUsageStatsOptions(parallelism=parallelism)
    return stream_bucket_usage_stats(
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
