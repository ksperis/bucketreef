# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.db import User
from app.models.bucket_purge import BucketPurgeRgwTargetRequest
from app.routers.bucket_purge_stream import stream_audited_bucket_purge
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.routers.dependencies import get_current_ceph_admin, require_bucket_purge_global_enabled
from app.services.s3_execution_context import build_ceph_admin_s3_context
from app.services.rgw_bucket_target import RgwBucketTarget
from app.services.bucket_purge_service import BucketPurgeOptions, BucketPurgeResolvedTarget, BucketPurgeService

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/buckets/purge", tags=["ceph-admin-bucket-purge"])
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_ceph_admin_bucket_purge(
    payload: BucketPurgeRgwTargetRequest,
    request: Request,
    _: None = Depends(require_bucket_purge_global_enabled),
    user: User = Depends(get_current_ceph_admin),
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    context = build_ceph_admin_s3_context(ctx)
    options = BucketPurgeOptions(
        parallelism=payload.parallelism,
        include_versions=payload.include_versions,
        individual_deletes=True,
    )
    context_id = f"ceph-admin-{ctx.endpoint.id}"
    targets = []
    for reference in payload.targets:
        target = RgwBucketTarget.create(ctx.endpoint.id, reference.tenant, reference.name)
        targets.append(
            BucketPurgeResolvedTarget(
                context=context,
                bucket_name=target.name,
                request_bucket_name=target.s3_name,
                context_id=context_id,
                context_name=ctx.endpoint.name,
            )
        )
    service = BucketPurgeService()
    base_metadata = {
        "target_count": len(targets),
        "bucket_sample": [
            {"name": reference.name, "tenant": reference.tenant}
            for reference in payload.targets[:20]
        ],
        "parallelism": options.parallelism,
        "include_versions": options.include_versions,
        "delete_strategy": "individual",
        "endpoint_id": ctx.endpoint.id,
        "endpoint_name": ctx.endpoint.name,
    }
    return stream_audited_bucket_purge(
        request,
        user=user,
        scope="ceph_admin",
        base_metadata=base_metadata,
        execution_context=context,
        run_purge=lambda progress_callback, cancel_check: service.run(
            targets,
            options,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="Ceph Admin bucket purge failed.",
    )
