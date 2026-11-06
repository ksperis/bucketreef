# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.sensitive_data import sanitize_error_detail
from app.services.rgw_admin import RGWAdminError


class CephAdminServiceError(RuntimeError):
    pass


class CephAdminValidationError(CephAdminServiceError):
    pass


class CephAdminConflictError(CephAdminServiceError):
    pass


class CephAdminNotFoundError(CephAdminServiceError):
    pass


class CephAdminUpstreamError(CephAdminServiceError):
    pass


class CephAdminUnsupportedError(CephAdminUpstreamError):
    pass


def upstream_error(exc: RGWAdminError) -> CephAdminUpstreamError:
    return CephAdminUpstreamError(sanitize_error_detail(str(exc)))
