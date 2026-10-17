# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.bucket_usage_stats import BucketUsageStatsTargetRequest
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.dependencies import get_s3_execution_context, get_current_storage_ops_admin
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)
from app.services.storage_ops_context_service import storage_ops_context_names

router = APIRouter(prefix="/storage-ops/buckets/usage-stats", tags=["storage-ops-bucket-usage-stats"])
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_storage_ops_bucket_usage_stats(
    payload: BucketUsageStatsTargetRequest,
    request: Request,
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    requested_targets = payload.targets
    context_names = storage_ops_context_names(user, db)
    options = BucketUsageStatsOptions(parallelism=payload.parallelism)
    targets = []
    for target in requested_targets:
        context = get_s3_execution_context(
            request=request,
            context_ref=target.context_id,
            actor=user,
            db=db,
        )
        resolved_context_id = context.context_id
        context_name = context_names.get(target.context_id) or context_names.get(resolved_context_id) or resolved_context_id
        targets.append(
            BucketUsageStatsResolvedTarget(
                context=context,
                bucket_name=target.bucket_name,
                scope_kind="manager",
                scope_id=resolved_context_id,
                scope_name=context_name,
                context_id=resolved_context_id,
                context_name=context_name,
            )
        )
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
            actor_user=user,
            actor_email=user.email,
            actor_role=user.role,
        ),
        logger=logger,
        failure_message="Storage Ops bucket usage stats calculation failed.",
    )
