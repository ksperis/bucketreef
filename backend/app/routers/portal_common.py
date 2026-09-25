# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared dependencies and HTTP error translation for Portal routers."""

from typing import NoReturn

from fastapi import Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.portal.exceptions import (
    PortalBadRequestError,
    PortalConflictError,
    PortalForbiddenError,
    PortalGoneError,
    PortalNotFoundError,
)
from app.services.portal_requests_service import (
    PortalRequestsService,
    get_portal_requests_service,
)
from app.services.portal_service import PortalService, get_portal_service
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_http_exception_from_exception


def get_portal_service_dependency(
    db: Session = Depends(get_db),
) -> PortalService:
    return get_portal_service(db)


def get_portal_requests_service_dependency(
    db: Session = Depends(get_db),
) -> PortalRequestsService:
    return get_portal_requests_service(db)


def raise_portal_error(exc: RuntimeError) -> NoReturn:
    if isinstance(exc, PortalBadRequestError):
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    if isinstance(exc, PortalForbiddenError):
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    if isinstance(exc, PortalNotFoundError):
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    if isinstance(exc, PortalConflictError):
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    if isinstance(exc, PortalGoneError):
        raise_http_exception_from_exception(status.HTTP_410_GONE, exc)
    raise_bad_gateway_from_runtime(exc)
