# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import PaginatedCephAdminUsersResponse
from app.models.ceph_admin_identity_listing import CephAdminUserListingRequest
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.routers.listing_common import require_advanced_filter_stream_payload, stream_listing_response
from app.services.ceph_admin_account_access import optional_account_lookup_enabled
from app.services.ceph_admin_user_listing import compute_users_listing
from app.services.listing_progress import ListingProgressSnapshot

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/users",
    tags=["ceph-admin-users"],
)
logger = logging.getLogger(__name__)


def _compute_users_listing(
    *,
    query: CephAdminUserListingRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminUsersResponse:
    return compute_users_listing(
        request=query,
        endpoint_id=int(ctx.endpoint.id),
        rgw_admin=ctx.rgw_admin,
        account_lookup_enabled=optional_account_lookup_enabled(ctx.endpoint),
        progress_callback=progress_callback,
        cancel_check=cancel_check,
    )


@router.get("", response_model=PaginatedCephAdminUsersResponse)
def list_rgw_users(
    query: Annotated[CephAdminUserListingRequest, Query()],
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminUsersResponse:
    return _compute_users_listing(
        query=query,
        ctx=ctx,
    )


@router.get("/stream")
async def stream_rgw_users(
    request: Request,
    query: Annotated[CephAdminUserListingRequest, Query()],
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    require_advanced_filter_stream_payload(query.advanced_filter)

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_users_listing(
            query=query,
            ctx=ctx,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="RGW users streaming search failed",
    )
