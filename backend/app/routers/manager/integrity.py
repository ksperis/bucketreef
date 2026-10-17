# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.db import User
from app.models.access_context import ManagerActor
from app.models.bucket_integrity import BucketIntegrityBucketRequest
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers.dependencies import (
    get_s3_execution_context,
    get_current_account_admin,
    require_bucket_integrity_check_enabled,
)
from app.routers.manager.access import require_bucket_management_context
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(prefix="/manager/bucket-integrity", tags=["manager-bucket-integrity"])
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_manager_bucket_integrity_check(
    payload: BucketIntegrityBucketRequest,
    request: Request,
    _tool_user: User = Depends(require_bucket_integrity_check_enabled),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    bucket_names = payload.buckets
    require_bucket_management_context(context)
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        check_mode=payload.check_mode,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    targets = [
        BucketIntegrityResolvedTarget(
            context=context,
            bucket_name=bucket_name,
            context_id=context.context_id,
            context_name=context.name,
        )
        for bucket_name in bucket_names
    ]
    service = BucketIntegrityCheckService()
    return stream_bucket_integrity_check(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Manager bucket integrity check failed.",
    )
