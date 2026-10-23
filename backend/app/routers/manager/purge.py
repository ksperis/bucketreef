# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.db import User
from app.models.access_context import ManagerActor
from app.models.bucket_purge import BucketPurgeBucketRequest
from app.routers.bucket_purge_stream import stream_audited_bucket_purge
from app.routers.dependencies import (
    get_s3_execution_context,
    get_current_account_admin,
    require_bucket_purge_enabled,
)
from app.routers.manager.access import require_bucket_management_context
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(prefix="/manager/bucket-purge", tags=["manager-bucket-purge"])
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_manager_bucket_purge(
    payload: BucketPurgeBucketRequest,
    request: Request,
    tool_user: User = Depends(require_bucket_purge_enabled),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    bucket_names = payload.buckets
    require_bucket_management_context(context)
    options = BucketPurgeOptions(parallelism=payload.parallelism, include_versions=payload.include_versions)
    targets = [
        BucketPurgeResolvedTarget(
            context=context,
            bucket_name=bucket_name,
            context_id=context.context_id,
            context_name=context.name,
        )
        for bucket_name in bucket_names
    ]
    service = BucketPurgeService()
    base_metadata = {
        "target_count": len(bucket_names),
        "bucket_sample": bucket_names[:20],
        "parallelism": options.parallelism,
        "include_versions": options.include_versions,
        "context_id": context.context_id,
    }
    return stream_audited_bucket_purge(
        request,
        user=tool_user,
        scope="manager",
        base_metadata=base_metadata,
        execution_context=context,
        run_purge=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Manager bucket purge failed.",
    )
