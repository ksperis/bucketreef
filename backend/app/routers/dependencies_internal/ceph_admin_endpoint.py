# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import NoReturn

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError, StorageEndpointProviderError
from app.db import StorageEndpoint
from app.services.ceph_admin_endpoint_service import (
    CephAdminEndpointService,
    CephAdminEndpointUnavailableError,
)


def raise_ceph_admin_endpoint_error(
    exc: (
        StorageEndpointNotFoundError
        | StorageEndpointProviderError
        | CephAdminEndpointUnavailableError
    ),
) -> NoReturn:
    if isinstance(exc, StorageEndpointNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
        detail = "Storage endpoint not found"
    elif isinstance(exc, StorageEndpointProviderError):
        status_code = status.HTTP_400_BAD_REQUEST
        detail = "Storage endpoint is not a Ceph provider"
    else:
        status_code = status.HTTP_403_FORBIDDEN
        detail = "Ceph Admin is not active on this endpoint"
    raise HTTPException(status_code=status_code, detail=detail) from exc


def resolve_ceph_admin_workspace_endpoint(
    db: Session,
    endpoint_id: int,
) -> StorageEndpoint:
    try:
        return CephAdminEndpointService(db).get_configured_endpoint(endpoint_id)
    except (
        StorageEndpointNotFoundError,
        StorageEndpointProviderError,
        CephAdminEndpointUnavailableError,
    ) as exc:
        raise_ceph_admin_endpoint_error(exc)
