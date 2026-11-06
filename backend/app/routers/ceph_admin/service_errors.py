# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

"""Translate Ceph Admin application errors at the HTTP route boundary."""

from typing import NoReturn

from fastapi import status

from app.services.ceph_admin_errors import (
    CephAdminConflictError,
    CephAdminNotFoundError,
    CephAdminServiceError,
    CephAdminValidationError,
)
from app.utils.http_errors import raise_http_exception_from_exception


def raise_ceph_admin_service_error(exc: CephAdminServiceError) -> NoReturn:
    if isinstance(exc, CephAdminValidationError):
        status_code = status.HTTP_400_BAD_REQUEST
    elif isinstance(exc, CephAdminNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, CephAdminConflictError):
        status_code = status.HTTP_409_CONFLICT
    else:
        status_code = status.HTTP_502_BAD_GATEWAY
    raise_http_exception_from_exception(status_code, exc)
