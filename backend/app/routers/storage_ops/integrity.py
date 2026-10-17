# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.bucket_integrity import BucketIntegrityTargetRequest
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers.dependencies import get_s3_execution_context, get_current_storage_ops_admin
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)
from app.services.storage_ops_context_service import storage_ops_context_names

router = APIRouter(prefix="/storage-ops/buckets/integrity-check", tags=["storage-ops-bucket-integrity"])
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_storage_ops_bucket_integrity_check(
    payload: BucketIntegrityTargetRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    requested_targets = payload.targets
    context_names = storage_ops_context_names(user, db)
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        check_mode=payload.check_mode,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    targets = [
        BucketIntegrityResolvedTarget(
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
        failure_message="Storage Ops bucket integrity check failed.",
    )
