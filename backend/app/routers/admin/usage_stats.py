# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import StorageEndpointNotFoundError, StorageEndpointProviderError
from app.db import User
from app.models.bucket_usage_stats import BucketUsageStatsAggregateResponse, BucketUsageStatsScopeRequest
from app.routers.bucket_usage_stats_stream import stream_resolved_bucket_usage_stats
from app.routers.dependencies import get_current_ui_admin
from app.services.admin_usage_stats_scope_service import AdminUsageStatsScopeService
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsService,
)
from app.services.buckets_service import BucketsService, get_buckets_service

router = APIRouter(tags=["admin-bucket-usage-stats"])
logger = logging.getLogger(__name__)


def _resolve_ceph_endpoint(
    scope_service: AdminUsageStatsScopeService,
    endpoint_id: int,
):
    try:
        return scope_service.resolve_ceph_endpoint(endpoint_id)
    except StorageEndpointNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except StorageEndpointProviderError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/admin/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def get_admin_managed_usage_stats_aggregate(
    endpoint_id: int = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ui_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> BucketUsageStatsAggregateResponse:
    scope_service = AdminUsageStatsScopeService(db, bucket_service)
    endpoint = _resolve_ceph_endpoint(scope_service, endpoint_id)
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
    _user: User = Depends(get_current_ui_admin),
    bucket_service: BucketsService = Depends(get_buckets_service),
) -> StreamingResponse:
    scope_service = AdminUsageStatsScopeService(db, bucket_service)
    endpoint = _resolve_ceph_endpoint(scope_service, endpoint_id)
    targets = scope_service.build_scope(endpoint).resolved_targets
    return stream_resolved_bucket_usage_stats(
        request,
        targets=targets,
        parallelism=payload.parallelism,
        logger=logger,
        failure_message="Admin managed usage stats calculation failed.",
    )
