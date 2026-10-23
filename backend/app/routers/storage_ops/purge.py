# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.bucket_purge import BucketPurgeTargetRequest
from app.routers.bucket_purge_stream import stream_audited_bucket_purge
from app.routers.dependencies import get_s3_execution_context, get_current_storage_ops_admin, require_bucket_purge_global_enabled
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService
from app.services.storage_ops_context_service import storage_ops_context_names

router = APIRouter(prefix="/storage-ops/buckets/purge", tags=["storage-ops-bucket-purge"])
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_storage_ops_bucket_purge(
    payload: BucketPurgeTargetRequest,
    request: Request,
    _: None = Depends(require_bucket_purge_global_enabled),
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    requested_targets = payload.targets
    context_names = storage_ops_context_names(user, db)
    options = BucketPurgeOptions(parallelism=payload.parallelism, include_versions=payload.include_versions)
    targets = [
        BucketPurgeResolvedTarget(
            context=get_s3_execution_context(
                request=request,
                context_ref=target.context_id,
                actor=user,
                db=db,
            ),
            bucket_name=target.bucket_name,
            context_id=target.context_id,
            context_name=context_names.get(target.context_id) or target.context_id,
        )
        for target in requested_targets
    ]
    service = BucketPurgeService()
    base_metadata = {
        "target_count": len(requested_targets),
        "bucket_sample": [target.bucket_name for target in requested_targets[:20]],
        "parallelism": options.parallelism,
        "include_versions": options.include_versions,
        "context_sample": [target.context_id for target in requested_targets[:20]],
    }
    return stream_audited_bucket_purge(
        request,
        user=user,
        scope="storage_ops",
        base_metadata=base_metadata,
        run_purge=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Storage Ops bucket purge failed.",
    )
