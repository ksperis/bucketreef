# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.models.bucket_integrity import BucketIntegrityRgwTargetRequest
from app.routers.bucket_integrity_stream import stream_bucket_integrity_check
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services.s3_execution_context import build_ceph_admin_s3_context
from app.services.rgw_bucket_target import RgwBucketTarget
from app.services.bucket_integrity_service import (
    BucketIntegrityCheckService,
    BucketIntegrityOptions,
    BucketIntegrityResolvedTarget,
)

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/buckets/integrity-check",
    tags=["ceph-admin-bucket-integrity"],
)
logger = logging.getLogger(__name__)


@router.post("/stream")
def stream_ceph_admin_bucket_integrity_check(
    payload: BucketIntegrityRgwTargetRequest,
    request: Request,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    context = build_ceph_admin_s3_context(ctx)
    options = BucketIntegrityOptions(
        parallelism=payload.parallelism,
        all_versions=payload.all_versions,
        check_mode=payload.check_mode,
        since=payload.since,
        max_mb_per_object=payload.max_mb_per_object,
    )
    targets = []
    for reference in payload.targets:
        target = RgwBucketTarget.create(ctx.endpoint.id, reference.tenant, reference.name)
        targets.append(
            BucketIntegrityResolvedTarget(
                context=context,
                bucket_name=target.name,
                request_bucket_name=target.s3_name,
                context_id=f"ceph-admin-{ctx.endpoint.id}",
                context_name=ctx.endpoint.name,
            )
        )
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
        failure_message="Ceph Admin bucket integrity check failed.",
    )
