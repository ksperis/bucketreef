# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.db.openstack import OpenStackCloud
from app.models.openstack import OpenStackCloudRead, OpenStackCloudWrite
from app.routers.dependencies import get_current_ui_superadmin
from app.routers.openstack import ui_session, cloud_read, _record_action
from app.services.identity_security_policy import require_admin_sensitive_action
from app.services.openstack_service import OpenStackService

router = APIRouter(prefix="/admin/openstack-clouds", tags=["openstack-admin"])


@router.get("", response_model=list[OpenStackCloudRead])
def list_clouds(db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    return [cloud_read(row) for row in db.scalars(select(OpenStackCloud).order_by(OpenStackCloud.name)).all()]


@router.post("", response_model=OpenStackCloudRead, status_code=201)
def create_cloud(payload: OpenStackCloudWrite, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    cloud = OpenStackService(db).save_cloud(payload)
    _record_action(db, user, "openstack.cloud.create", "OpenStackCloud", cloud.id)
    return cloud_read(cloud)


@router.put("/{cloud_id}", response_model=OpenStackCloudRead)
def update_cloud(cloud_id: int, payload: OpenStackCloudWrite, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    cloud = OpenStackService(db).save_cloud(payload, cloud_id)
    _record_action(db, user, "openstack.cloud.update", "OpenStackCloud", cloud.id)
    return cloud_read(cloud)


@router.delete("/{cloud_id}", status_code=204)
def delete_cloud(cloud_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    OpenStackService(db).delete_cloud(cloud_id)
    _record_action(db, user, "openstack.cloud.delete", "OpenStackCloud", cloud_id)
