# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.admin_listing import AdminPaginatedListingRequest
from app.models.openstack import (
    OpenStackCloudRead,
    OpenStackCloudWrite,
    PaginatedOpenStackCloudsResponse,
)
from app.routers.dependencies import get_current_ui_superadmin
from app.routers.identity_security_policy import require_admin_sensitive_action
from app.routers.openstack import ui_session, _record_action
from app.services.openstack_service import OpenStackService

router = APIRouter(prefix="/admin/openstack-clouds", tags=["openstack-admin"])


@router.get("", response_model=list[OpenStackCloudRead])
def list_clouds(db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    return OpenStackService(db).admin_clouds()


@router.get("/options", response_model=PaginatedOpenStackCloudsResponse)
def list_cloud_options(
    query: Annotated[AdminPaginatedListingRequest, Query()],
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ui_superadmin),
    session=Depends(ui_session),
) -> PaginatedOpenStackCloudsResponse:
    _ = user, session
    return OpenStackService(db).paginated_admin_clouds(query)


@router.post("", response_model=OpenStackCloudRead, status_code=201)
def create_cloud(payload: OpenStackCloudWrite, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    service = OpenStackService(db)
    cloud = service.save_cloud(payload)
    _record_action(db, user, "admin", "openstack.cloud.create", "OpenStackCloud", cloud.id)
    return service.cloud_read(cloud)


@router.put("/{cloud_id}", response_model=OpenStackCloudRead)
def update_cloud(cloud_id: int, payload: OpenStackCloudWrite, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    service = OpenStackService(db)
    cloud = service.save_cloud(payload, cloud_id)
    _record_action(db, user, "admin", "openstack.cloud.update", "OpenStackCloud", cloud.id)
    return service.cloud_read(cloud)


@router.delete("/{cloud_id}", status_code=204)
def delete_cloud(cloud_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    OpenStackService(db).delete_cloud(cloud_id)
    _record_action(db, user, "admin", "openstack.cloud.delete", "OpenStackCloud", cloud_id)
