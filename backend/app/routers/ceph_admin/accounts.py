# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Annotated, Callable

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.models.ceph_admin import PaginatedCephAdminAccountsResponse
from app.models.ceph_admin_identity_listing import CephAdminAccountListingRequest
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.routers.ceph_admin.service_errors import raise_ceph_admin_service_error
from app.services.ceph_admin_context import CephAdminContext
from app.routers.listing_common import require_advanced_filter_stream_payload, stream_listing_response
from app.services.ceph_admin_account_listing import compute_accounts_listing
from app.services.ceph_admin_errors import CephAdminServiceError
from app.services.listing_filter_query import ListingFilterQueryError
from app.services.listing_progress import ListingProgressSnapshot
from app.utils.http_errors import raise_bad_request_from_value_error

router = APIRouter(
    prefix="/ceph-admin/endpoints/{endpoint_id}/accounts",
    tags=["ceph-admin-accounts"],
)
logger = logging.getLogger(__name__)


def _compute_accounts_listing(
    *,
    query: CephAdminAccountListingRequest,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminAccountsResponse:
    try:
        return compute_accounts_listing(
            request=query,
            endpoint_id=int(ctx.endpoint.id),
            rgw_admin=ctx.rgw_admin,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
    except ListingFilterQueryError as exc:
        raise_bad_request_from_value_error(exc)
    except CephAdminServiceError as exc:
        raise_ceph_admin_service_error(exc)


@router.get("", response_model=PaginatedCephAdminAccountsResponse)
def list_rgw_accounts(
    query: Annotated[CephAdminAccountListingRequest, Query()],
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> PaginatedCephAdminAccountsResponse:
    return _compute_accounts_listing(
        query=query,
        ctx=ctx,
    )


@router.get("/stream")
async def stream_rgw_accounts(
    request: Request,
    query: Annotated[CephAdminAccountListingRequest, Query()],
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> StreamingResponse:
    require_advanced_filter_stream_payload(query.advanced_filter)

    return stream_listing_response(
        request,
        compute=lambda progress_callback, cancel_check: _compute_accounts_listing(
            query=query,
            ctx=ctx,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        logger=logger,
        failure_message="RGW accounts streaming search failed",
    )
