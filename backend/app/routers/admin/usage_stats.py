# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.bucket_usage_stats import BucketUsageStatsAggregateResponse, BucketUsageStatsScopeRequest
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.dependencies import get_current_super_admin
from app.services.admin_usage_stats_scope_service import AdminUsageStatsScopeService
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsService,
)
from app.services.buckets_service import BucketsService, get_buckets_service

router = APIRouter(tags=["admin-bucket-usage-stats"])
logger = logging.getLogger(__name__)

@router.get("/admin/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def get_admin_managed_usage_stats_aggregate(
    endpoint_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_super_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> BucketUsageStatsAggregateResponse:
    scope_service = AdminUsageStatsScopeService(db, bucket_service)
    endpoint = scope_service.resolve_ceph_endpoint(endpoint_id)
    scope = scope_service.build_scope(endpoint)
    aggregate = BucketUsageStatsService().get_aggregate_for_targets(
        db,
        scope_kind="admin_managed",
        scope_id=str(endpoint.id),
        scope_name=endpoint.name,
        targets=scope.aggregate_targets,
        warnings=scope.warnings,
        managed_account_count=scope.managed_account_count,
        accounts_with_listed_buckets=scope.accounts_with_listed_buckets,
        skipped_account_count=scope.skipped_account_count,
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.post("/admin/usage-stats/stream")
def stream_admin_managed_usage_stats_aggregate(
    payload: BucketUsageStatsScopeRequest,
    request: Request,
    endpoint_id: int = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_super_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> StreamingResponse:
    scope_service = AdminUsageStatsScopeService(db, bucket_service)
    endpoint = scope_service.resolve_ceph_endpoint(endpoint_id)
    targets = scope_service.build_scope(endpoint).resolved_targets
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            BucketUsageStatsOptions(parallelism=payload.parallelism),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Admin managed usage stats calculation failed.",
    )
