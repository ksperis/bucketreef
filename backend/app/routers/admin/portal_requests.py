# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.db import User
from app.models.portal_requests import (
    PaginatedPortalAdminRequestsResponse,
    PortalAdminRequestDecision,
    PortalAdminRequestListingRequest,
    PortalAdminRequestMessageCreate,
    PortalAdminRequestOut,
)
from app.routers.dependencies import get_current_ui_admin
from app.routers.portal_common import get_portal_requests_service_dependency
from app.services.portal_requests_service import (
    PortalRequestExecutionError,
    PortalRequestsService,
)
from app.utils.http_errors import (
    raise_http_error_from_value_error,
    raise_http_exception_from_exception,
)

router = APIRouter(prefix="/admin/portal-requests", tags=["admin-portal-requests"])


@router.get("", response_model=PaginatedPortalAdminRequestsResponse)
def list_admin_portal_requests(
    query: Annotated[PortalAdminRequestListingRequest, Query()],
    _: User = Depends(get_current_ui_admin),
    service: PortalRequestsService = Depends(get_portal_requests_service_dependency),
) -> PaginatedPortalAdminRequestsResponse:
    return service.list_for_admin(query)


@router.post("/{request_id}/approve", response_model=PortalAdminRequestOut)
def approve_admin_portal_request(
    request_id: int,
    payload: PortalAdminRequestDecision,
    current_user: User = Depends(get_current_ui_admin),
    service: PortalRequestsService = Depends(get_portal_requests_service_dependency),
) -> PortalAdminRequestOut:
    try:
        return service.approve_request(request_id, current_user, message=payload.message)
    except PortalRequestExecutionError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.post("/{request_id}/reject", response_model=PortalAdminRequestOut)
def reject_admin_portal_request(
    request_id: int,
    payload: PortalAdminRequestDecision,
    current_user: User = Depends(get_current_ui_admin),
    service: PortalRequestsService = Depends(get_portal_requests_service_dependency),
) -> PortalAdminRequestOut:
    try:
        return service.reject_request(request_id, current_user, message=payload.message)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.post("/{request_id}/messages", response_model=PortalAdminRequestOut)
def add_admin_portal_request_message(
    request_id: int,
    payload: PortalAdminRequestMessageCreate,
    current_user: User = Depends(get_current_ui_admin),
    service: PortalRequestsService = Depends(get_portal_requests_service_dependency),
) -> PortalAdminRequestOut:
    try:
        return service.add_admin_message(request_id, current_user, payload.message)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
