# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable

from fastapi import Request
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import CephAdminBucketIndexCheckBatchProgress, CephAdminBucketIndexCheckBatchResult
from app.routers.sse_worker import stream_status_operation
from app.services.bucket_index_check_service import BucketIndexCheckCancelled

def stream_bucket_index_checks(
    request: Request,
    *,
    run_check: Callable[
        [Callable[[CephAdminBucketIndexCheckBatchProgress], None], Callable[[], None]],
        CephAdminBucketIndexCheckBatchResult,
    ],
    logger: logging.Logger,
) -> StreamingResponse:
    return stream_status_operation(
        request,
        run_operation=run_check,
        cancelled_error=BucketIndexCheckCancelled,
        logger=logger,
        operation="bucket_index_check",
        failure_message="Ceph Admin bucket index checks failed.",
    )
