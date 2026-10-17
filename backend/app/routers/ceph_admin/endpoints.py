# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageEndpoint as DbStorageEndpoint, User
from app.models.ceph_admin import (
    CephAdminEndpoint,
    CephAdminEndpointAccess,
)
from app.routers.ceph_admin.dependencies import get_ceph_admin_workspace_endpoint
from app.routers.dependencies import get_current_ceph_admin
from app.services.ceph_admin_endpoint_service import CephAdminEndpointService

router = APIRouter(prefix="/ceph-admin/endpoints", tags=["ceph-admin-endpoints"])


@router.get("", response_model=list[CephAdminEndpoint])
def list_ceph_admin_endpoints(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> list[CephAdminEndpoint]:
    return CephAdminEndpointService(db).list_endpoints()


@router.get("/{endpoint_id}/access", response_model=CephAdminEndpointAccess)
def get_ceph_admin_endpoint_access(
    endpoint: DbStorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
    probe: bool = False,
) -> CephAdminEndpointAccess:
    return CephAdminEndpointService.get_access(endpoint, probe=probe)
