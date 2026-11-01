# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.db.openstack import OpenStackCloud
from app.models.openstack import (
    OpenStackCloudRead,
    OpenStackCloudWrite,
    PaginatedOpenStackCloudsResponse,
)
from app.routers.dependencies import get_current_ui_superadmin
from app.routers.openstack import ui_session, cloud_read, _record_action
from app.services.identity_security_policy import require_admin_sensitive_action
from app.services.openstack_service import OpenStackService

router = APIRouter(prefix="/admin/openstack-clouds", tags=["openstack-admin"])


@router.get("", response_model=list[OpenStackCloudRead])
def list_clouds(db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    return [cloud_read(row) for row in db.scalars(select(OpenStackCloud).order_by(OpenStackCloud.name)).all()]


@router.get("/options", response_model=PaginatedOpenStackCloudsResponse)
def list_cloud_options(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_ui_superadmin),
    session=Depends(ui_session),
) -> PaginatedOpenStackCloudsResponse:
    _ = user, session
    query = select(OpenStackCloud)
    count_query = select(func.count()).select_from(OpenStackCloud)
    normalized_search = (search or "").strip()
    if normalized_search:
        predicate = OpenStackCloud.name.ilike(f"%{normalized_search}%")
        query = query.where(predicate)
        count_query = count_query.where(predicate)
    total = int(db.scalar(count_query) or 0)
    rows = db.scalars(
        query.order_by(OpenStackCloud.name, OpenStackCloud.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return PaginatedOpenStackCloudsResponse(
        items=[cloud_read(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_next=page * page_size < total,
    )


@router.post("", response_model=OpenStackCloudRead, status_code=201)
def create_cloud(payload: OpenStackCloudWrite, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    cloud = OpenStackService(db).save_cloud(payload)
    _record_action(db, user, "admin", "openstack.cloud.create", "OpenStackCloud", cloud.id)
    return cloud_read(cloud)


@router.put("/{cloud_id}", response_model=OpenStackCloudRead)
def update_cloud(cloud_id: int, payload: OpenStackCloudWrite, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    cloud = OpenStackService(db).save_cloud(payload, cloud_id)
    _record_action(db, user, "admin", "openstack.cloud.update", "OpenStackCloud", cloud.id)
    return cloud_read(cloud)


@router.delete("/{cloud_id}", status_code=204)
def delete_cloud(cloud_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_ui_superadmin), session=Depends(ui_session)):
    require_admin_sensitive_action(request, db, user)
    OpenStackService(db).delete_cloud(cloud_id)
    _record_action(db, user, "admin", "openstack.cloud.delete", "OpenStackCloud", cloud_id)
