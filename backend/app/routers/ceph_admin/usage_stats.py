# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.db import User
from app.models.bucket_usage_stats import (
    BucketUsageStatsAggregateResponse,
    BucketUsageStatsLatestResponse,
    BucketUsageStatsRgwTargetRequest,
    BucketUsageStatsScopeRequest,
)
from app.models.bucket_operation import RgwBucketReference
from app.routers.bucket_usage_stats_stream import stream_bucket_usage_stats
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services.ceph_admin_bucket_listing_cache import get_cached_rgw_bucket_entries
from app.services.rgw_bucket_metadata import extract_bucket_identity
from app.routers.dependencies import get_current_ceph_admin
from app.services.s3_execution_context import build_ceph_admin_s3_context
from app.services.rgw_bucket_target import RgwBucketTarget
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter(tags=["ceph-admin-bucket-usage-stats"])
logger = logging.getLogger(__name__)


def _target_for_bucket(
    ctx: CephAdminContext,
    reference: RgwBucketReference,
) -> BucketUsageStatsResolvedTarget:
    context = build_ceph_admin_s3_context(ctx)
    context_id = f"ceph-admin-{ctx.endpoint.id}"
    target = RgwBucketTarget.create(ctx.endpoint.id, reference.tenant, reference.name)
    return BucketUsageStatsResolvedTarget(
        context=context,
        bucket_name=target.name,
        bucket_tenant=target.tenant,
        request_bucket_name=target.s3_name,
        scope_kind="ceph_admin",
        scope_id=str(ctx.endpoint.id),
        scope_name=ctx.endpoint.name,
        context_id=context_id,
        context_name=ctx.endpoint.name,
    )


def _list_ceph_bucket_references(ctx: CephAdminContext) -> list[RgwBucketReference]:
    try:
        entries = get_cached_rgw_bucket_entries(ctx, with_stats=False)
    except Exception as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    references: list[RgwBucketReference] = []
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        bucket_name, tenant, _tenant_metadata_resolved = extract_bucket_identity(entry)
        if bucket_name:
            reference = RgwBucketReference(
                name=bucket_name,
                tenant=tenant or "",
            )
            key = (reference.tenant, reference.name)
            if key not in seen:
                seen.add(key)
                references.append(reference)
    return references


@router.get("/ceph-admin/endpoints/{endpoint_id}/usage-stats/latest", response_model=BucketUsageStatsAggregateResponse)
def get_ceph_admin_usage_stats_aggregate(
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketUsageStatsAggregateResponse:
    references = _list_ceph_bucket_references(ctx)
    aggregate = BucketUsageStatsService().get_aggregate_for_targets(
        db,
        scope_kind="ceph_admin",
        scope_id=str(ctx.endpoint.id),
        scope_name=ctx.endpoint.name,
        targets=[
            BucketUsageStatsAggregateTarget(
                scope_kind="ceph_admin",
                scope_id=str(ctx.endpoint.id),
                bucket_name=reference.name,
                bucket_tenant=reference.tenant,
            )
            for reference in references
        ],
    )
    return BucketUsageStatsAggregateResponse(aggregate=aggregate)


@router.post("/ceph-admin/endpoints/{endpoint_id}/usage-stats/stream")
def stream_ceph_admin_usage_stats_aggregate(
    payload: BucketUsageStatsScopeRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    _user: User = Depends(get_current_ceph_admin),
) -> StreamingResponse:
    references = _list_ceph_bucket_references(ctx)
    targets = [_target_for_bucket(ctx, reference) for reference in references]
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
        failure_message="Ceph Admin usage stats calculation failed.",
    )


@router.get("/ceph-admin/endpoints/{endpoint_id}/buckets/{bucket_name}/usage-stats", response_model=BucketUsageStatsLatestResponse)
def get_ceph_admin_bucket_usage_stats(
    bucket_name: str,
    tenant: str = Query(default=""),
    db: Session = Depends(get_db),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketUsageStatsLatestResponse:
    snapshot = BucketUsageStatsService().get_latest(
        db,
        scope_kind="ceph_admin",
        scope_id=str(ctx.endpoint.id),
        bucket_name=bucket_name,
        bucket_tenant=(tenant or "").strip(),
    )
    return BucketUsageStatsLatestResponse(snapshot=snapshot)


@router.post("/ceph-admin/endpoints/{endpoint_id}/buckets/{bucket_name}/usage-stats/stream")
def stream_ceph_admin_bucket_usage_stats_for_bucket(
    bucket_name: str,
    request: Request,
    tenant: str = Query(default=""),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    _user: User = Depends(get_current_ceph_admin),
) -> StreamingResponse:
    target = _target_for_bucket(
        ctx,
        RgwBucketReference(name=bucket_name, tenant=tenant),
    )
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            [target],
            BucketUsageStatsOptions(parallelism=1),
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Ceph Admin bucket usage stats calculation failed.",
    )


@router.post("/ceph-admin/endpoints/{endpoint_id}/bucket-usage-stats/stream")
def stream_ceph_admin_bucket_usage_stats(
    payload: BucketUsageStatsRgwTargetRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    _user: User = Depends(get_current_ceph_admin),
) -> StreamingResponse:
    options = BucketUsageStatsOptions(parallelism=payload.parallelism)
    targets = [_target_for_bucket(ctx, reference) for reference in payload.targets]
    service = BucketUsageStatsService(SessionLocal)
    return stream_bucket_usage_stats(
        request,
        run_check=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Ceph Admin bucket usage stats calculation failed.",
    )
