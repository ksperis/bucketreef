# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.access_key_metadata import AccessKeyMetadata, AccessKeyMetadataInput
from app.services.s3_execution_context import S3ExecutionContext
from app.models.s3_user import S3UserAccessKey, S3UserAccessKeyStatusChange, S3UserGeneratedKey
from app.routers.dependencies import (
    get_audit_service,
    get_current_account_user,
    require_manager_rgw_access_key_management,
)
from app.services.audit_service import AuditService
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.s3_users_service import S3UsersService, get_s3_users_service
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.utils.http_errors import raise_http_error_from_value_error

router = APIRouter(prefix="/manager/ceph/keys", tags=["manager-ceph-keys"])


def get_manager_ceph_s3_users_service(
    db: Session = Depends(get_db),
) -> S3UsersService:
    return get_s3_users_service(db)


def _resolve_s3_user_id(account: S3ExecutionContext) -> int:
    s3_user_id = getattr(account, "s3_user_id", None)
    if not isinstance(s3_user_id, int) or s3_user_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ceph key management is not available for this context",
        )
    return s3_user_id


@router.get("", response_model=list[S3UserAccessKey])
def list_ceph_access_keys(
    account: S3ExecutionContext = Depends(require_manager_rgw_access_key_management),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    _: User = Depends(get_current_account_user),
    db: Session = Depends(get_db),
) -> list[S3UserAccessKey]:
    try:
        source_id = _resolve_s3_user_id(account)
        keys = service.list_keys(source_id)
        metadata_service = AccessKeyMetadataService(db)
        if metadata_service.enabled_for_context(account):
            metadata_service.apply_metadata(keys, metadata_service.s3_user_metadata(source_id))
        managed = {
            row.access_key_id: row
            for row in ManagedPrivateAccessService(db).managed_resources_for_source("s3_user", source_id)
            if row.access_key_id
        }
        for key in keys:
            provisioning = managed.get(key.access_key_id)
            if provisioning is not None:
                key.is_private_access_managed = True
                key.managed_connection_id = provisioning.s3_connection_id
        return keys
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.post("", response_model=S3UserGeneratedKey, status_code=status.HTTP_201_CREATED)
def create_ceph_access_key(
    payload: AccessKeyMetadataInput | None = None,
    account: S3ExecutionContext = Depends(require_manager_rgw_access_key_management),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> S3UserGeneratedKey:
    s3_user_id = _resolve_s3_user_id(account)
    try:
        key = service.create_access_key_entry(s3_user_id)
        metadata_service = AccessKeyMetadataService(db)
        if payload is not None and (payload.name is not None or payload.notes is not None):
            if not metadata_service.enabled_for_context(account):
                service.delete_key(s3_user_id, key.access_key_id)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access-key metadata is not enabled for this Manager context",
                )
            metadata_service.set_s3_user_metadata(s3_user_id, key.access_key_id, payload)
            key.name = payload.name
            key.notes = payload.notes
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="create_s3_user_access_key",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": key.access_key_id},
        )
        return key
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.put("/{access_key}/metadata", response_model=AccessKeyMetadata)
def update_ceph_access_key_metadata(
    access_key: str,
    payload: AccessKeyMetadataInput,
    account: S3ExecutionContext = Depends(require_manager_rgw_access_key_management),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> AccessKeyMetadata:
    s3_user_id = _resolve_s3_user_id(account)
    metadata_service = AccessKeyMetadataService(db)
    if not metadata_service.enabled_for_context(account):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access-key metadata is not enabled for this Manager context",
        )
    try:
        if not any(key.access_key_id == access_key for key in service.list_keys(s3_user_id)):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Access key not found")
        metadata_service.set_s3_user_metadata(s3_user_id, access_key, payload)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_s3_user_access_key_metadata",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": access_key, "has_name": bool(payload.name), "has_notes": bool(payload.notes)},
        )
        return AccessKeyMetadata(name=payload.name, notes=payload.notes)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.put("/{access_key}/status", response_model=S3UserAccessKey)
def update_ceph_access_key_status(
    access_key: str,
    payload: S3UserAccessKeyStatusChange,
    account: S3ExecutionContext = Depends(require_manager_rgw_access_key_management),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> S3UserAccessKey:
    s3_user_id = _resolve_s3_user_id(account)
    if ManagedPrivateAccessService(db).managed_key("s3_user", s3_user_id, access_key) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; update or delete its private connection instead",
        )
    try:
        updated = service.set_key_status(s3_user_id, access_key, payload.active)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="update_s3_user_access_key_status",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": access_key, "active": payload.active},
        )
        return updated
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.delete(
    "/{access_key}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    response_model=None,
)
def delete_ceph_access_key(
    access_key: str,
    account: S3ExecutionContext = Depends(require_manager_rgw_access_key_management),
    service: S3UsersService = Depends(get_manager_ceph_s3_users_service),
    current_user: User = Depends(get_current_account_user),
    audit_service: AuditService = Depends(get_audit_service),
    db: Session = Depends(get_db),
) -> Response:
    s3_user_id = _resolve_s3_user_id(account)
    if ManagedPrivateAccessService(db).managed_key("s3_user", s3_user_id, access_key) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This key belongs to a managed private access; delete its private connection instead",
        )
    try:
        service.delete_key(s3_user_id, access_key)
        AccessKeyMetadataService(db).delete_s3_user_metadata(s3_user_id, access_key)
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action="delete_s3_user_access_key",
            entity_type="s3_user",
            entity_id=str(s3_user_id),
            account=account,
            metadata={"access_key_id": access_key},
        )
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
