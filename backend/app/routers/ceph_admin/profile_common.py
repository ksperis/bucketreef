# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""HTTP translation shared by Ceph Admin RGW profile routes."""

from typing import NoReturn

from fastapi import status

from app.services.ceph_admin_profile_mutations import (
    CephAdminProfileConflictError,
    CephAdminProfileNotFoundError,
    CephAdminProfileServiceError,
)
from app.utils.http_errors import raise_http_exception_from_exception


def raise_profile_service_error(exc: CephAdminProfileServiceError) -> NoReturn:
    if isinstance(exc, CephAdminProfileConflictError):
        status_code = status.HTTP_409_CONFLICT
    elif isinstance(exc, CephAdminProfileNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    else:
        status_code = status.HTTP_502_BAD_GATEWAY
    raise_http_exception_from_exception(status_code, exc)
