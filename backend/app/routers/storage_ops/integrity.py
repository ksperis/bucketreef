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
from app.routers.bucket_integrity_stream import stream_resolved_bucket_integrity_check
from app.routers.dependencies import get_s3_execution_context, get_current_storage_ops_admin
from app.services.s3_execution_context import ResolvedS3BucketTarget

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
    targets: list[ResolvedS3BucketTarget] = []
    for target in requested_targets:
        context = get_s3_execution_context(
            request=request,
            context_ref=target.context_id,
            actor=user,
            db=db,
        )
        targets.append(
            ResolvedS3BucketTarget(
                context=context,
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=context.name,
            )
        )
    return stream_resolved_bucket_integrity_check(
        request,
        payload=payload,
        targets=targets,
        logger=logger,
        failure_message="Storage Ops bucket integrity check failed.",
    )
