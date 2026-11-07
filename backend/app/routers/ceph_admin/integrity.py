# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.models.bucket_integrity import BucketIntegrityRgwTargetRequest
from app.routers.bucket_integrity_stream import stream_resolved_bucket_integrity_check
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services.s3_execution_context import ResolvedS3BucketTarget, build_ceph_admin_s3_context
from app.services.rgw_bucket_target import RgwBucketTarget

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
    targets = []
    for reference in payload.targets:
        target = RgwBucketTarget.create(ctx.endpoint.id, reference.tenant, reference.name)
        targets.append(
            ResolvedS3BucketTarget(
                context=context,
                bucket_name=target.name,
                request_bucket_name=target.s3_name,
                context_id=f"ceph-admin-{ctx.endpoint.id}",
                context_name=ctx.endpoint.name,
            )
        )
    return stream_resolved_bucket_integrity_check(
        request,
        payload=payload,
        targets=targets,
        logger=logger,
        failure_message="Ceph Admin bucket integrity check failed.",
    )
