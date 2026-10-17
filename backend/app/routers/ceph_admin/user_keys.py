# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW user access-key routes."""

from typing import Optional

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ceph_admin import (
    CephAdminRgwAccessKey,
    CephAdminRgwAccessKeyStatusChange,
    CephAdminRgwGeneratedAccessKey,
)
from app.routers.ceph_admin.dependencies import get_ceph_admin_context
from app.services.ceph_admin_context import CephAdminContext
from app.services.ceph_admin_user_key_service import CephAdminUserKeyService

router = APIRouter()


@router.get("/{user_id}/keys", response_model=list[CephAdminRgwAccessKey])
def list_rgw_user_keys(
    user_id: str,
    tenant: Optional[str] = None,
    expected_account_id: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> list[CephAdminRgwAccessKey]:
    return CephAdminUserKeyService(ctx, db).list_keys(
        user_id,
        tenant=tenant,
        expected_account_id=expected_account_id,
    )


@router.post("/{user_id}/keys", response_model=CephAdminRgwGeneratedAccessKey, status_code=status.HTTP_201_CREATED)
def create_rgw_user_key(
    user_id: str,
    tenant: Optional[str] = None,
    expected_account_id: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> CephAdminRgwGeneratedAccessKey:
    return CephAdminUserKeyService(ctx, db).create_key(
        user_id,
        tenant=tenant,
        expected_account_id=expected_account_id,
    )


@router.put("/{user_id}/keys/{access_key}/status", response_model=CephAdminRgwAccessKey)
def update_rgw_user_key_status(
    user_id: str,
    access_key: str,
    update: CephAdminRgwAccessKeyStatusChange,
    tenant: Optional[str] = None,
    expected_account_id: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> CephAdminRgwAccessKey:
    return CephAdminUserKeyService(ctx, db).update_status(
        user_id,
        access_key,
        active=update.active,
        tenant=tenant,
        expected_account_id=expected_account_id,
    )


@router.delete("/{user_id}/keys/{access_key}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_rgw_user_key(
    user_id: str,
    access_key: str,
    tenant: Optional[str] = None,
    expected_account_id: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> Response:
    CephAdminUserKeyService(ctx, db).delete_key(
        user_id,
        access_key,
        tenant=tenant,
        expected_account_id=expected_account_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
