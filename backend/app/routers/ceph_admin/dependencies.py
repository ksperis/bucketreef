# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import StorageEndpoint, StorageProvider, User
from app.routers.dependencies import get_current_ceph_admin
from app.services.audit_service import AuditService
from app.services.ceph_admin_context import CephAdminContext
from app.services.ceph_admin_service_identity import (
    validate_ceph_admin_service_configuration,
)
from app.services.rgw_admin import get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint


def _resolve_storage_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = _resolve_ceph_admin_workspace_endpoint(db, endpoint_id)
    identity = endpoint.service_identity("ceph_admin")
    access_key = identity.access_key if identity is not None else None
    secret_key = identity.secret_key if identity is not None else None
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ceph Admin credentials are not configured for this storage endpoint",
        )
    return endpoint


def _resolve_ceph_admin_workspace_endpoint(db: Session, endpoint_id: int) -> StorageEndpoint:
    endpoint = db.query(StorageEndpoint).filter(StorageEndpoint.id == endpoint_id).first()
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Storage endpoint not found")
    if endpoint.provider != StorageProvider.CEPH.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Storage endpoint is not a Ceph provider")
    from app.services.app_settings_service import load_app_settings_for_db_readonly
    if not load_app_settings_for_db_readonly(db).general.ceph_admin_enabled or validate_ceph_admin_service_configuration(endpoint):
        raise HTTPException(status_code=403, detail="Ceph Admin is not active on this endpoint")
    return endpoint


def get_ceph_admin_context(
    endpoint_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> CephAdminContext:
    endpoint = _resolve_storage_endpoint(db, endpoint_id)
    admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
    identity = endpoint.service_identity("ceph_admin")
    assert identity is not None and identity.access_key and identity.secret_key
    access_key = identity.access_key
    secret_key = identity.secret_key
    region = endpoint.region
    rgw_admin = get_rgw_admin_client(
        access_key=access_key,
        secret_key=secret_key,
        endpoint=admin_endpoint,
        region=region,
        verify_tls=endpoint.verify_tls,
    )
    return CephAdminContext(
        endpoint=endpoint,
        rgw_admin=rgw_admin,
        s3_endpoint=endpoint.endpoint_url,
        region=region,
        access_key=access_key,
        secret_key=secret_key,
        actor=_,
        audit_service=AuditService(db),
    )


def get_ceph_admin_workspace_endpoint(
    endpoint_id: int = Path(..., ge=1),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ceph_admin),
) -> StorageEndpoint:
    return _resolve_ceph_admin_workspace_endpoint(db, endpoint_id)
