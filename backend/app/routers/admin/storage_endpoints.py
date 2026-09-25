# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointCreate,
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
    StorageEndpointMeta,
    StorageEndpointTagsUpdate,
    StorageEndpointUpdate,
)
from app.routers.dependencies import get_audit_service, get_current_super_admin, get_current_ui_superadmin
from app.services.audit_service import AuditService
from app.services.healthcheck_background_service import run_initial_healthchecks
from app.services.identity_security_policy import (
    require_admin_interactive_session,
    require_admin_sensitive_action,
)
from app.services.storage_endpoints_service import StorageEndpointsService, get_storage_endpoints_service
from app.services.tags_service import serialize_tag_summaries
from app.utils.http_errors import raise_bad_request_or_not_found

router = APIRouter(prefix="/admin/storage-endpoints", tags=["admin-storage-endpoints"])
logger = logging.getLogger(__name__)


def get_service(db: Session = Depends(get_db)) -> StorageEndpointsService:
    return get_storage_endpoints_service(db)


@router.get("", response_model=list[StorageEndpoint])
def list_storage_endpoints(
    include_admin_ops_permissions: bool = Query(False),
    service: StorageEndpointsService = Depends(get_service),
    _: User = Depends(get_current_super_admin),
) -> list[StorageEndpoint]:
    return service.list_endpoints(include_admin_ops_permissions=include_admin_ops_permissions)


@router.get("/meta", response_model=StorageEndpointMeta)
def get_storage_endpoints_meta(
    service: StorageEndpointsService = Depends(get_service),
    _: User = Depends(get_current_super_admin),
) -> StorageEndpointMeta:
    return StorageEndpointMeta(managed_by_env=service.env_endpoints_locked())


@router.post("/detect-features", response_model=StorageEndpointFeatureDetectionResult)
def detect_storage_endpoint_features(
    request: Request,
    payload: StorageEndpointFeatureDetectionRequest,
    service: StorageEndpointsService = Depends(get_service),
    current_user: User = Depends(get_current_ui_superadmin),
) -> StorageEndpointFeatureDetectionResult:
    require_admin_interactive_session(request, service.db, current_user)
    try:
        return service.detect_features(payload)
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)


@router.get("/{endpoint_id}", response_model=StorageEndpoint)
def get_storage_endpoint(
    endpoint_id: int,
    include_admin_ops_permissions: bool = Query(True),
    service: StorageEndpointsService = Depends(get_service),
    _: User = Depends(get_current_super_admin),
) -> StorageEndpoint:
    try:
        return service.get_endpoint(endpoint_id, include_admin_ops_permissions=include_admin_ops_permissions)
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)


@router.post("", response_model=StorageEndpoint, status_code=status.HTTP_201_CREATED)
def create_storage_endpoint(
    request: Request,
    payload: StorageEndpointCreate,
    background_tasks: BackgroundTasks,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: User = Depends(get_current_ui_superadmin),
) -> StorageEndpoint:
    require_admin_sensitive_action(request, service.db, current_user)
    try:
        created = service.create_endpoint(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(created.id),
            metadata={
                "endpoint_url": created.endpoint_url,
                "provider": created.provider.value,
                "admin_endpoint": created.features.admin.endpoint,
                "force_path_style": created.force_path_style,
                "verify_tls": created.verify_tls,
            },
        )
        background_tasks.add_task(run_initial_healthchecks, endpoint_id=created.id)
        return created
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)


@router.put("/{endpoint_id}", response_model=StorageEndpoint)
def update_storage_endpoint(
    request: Request,
    endpoint_id: int,
    payload: StorageEndpointUpdate,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: User = Depends(get_current_ui_superadmin),
) -> StorageEndpoint:
    require_admin_sensitive_action(request, service.db, current_user)
    try:
        updated = service.update_endpoint(endpoint_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
            metadata={
                "endpoint_url": updated.endpoint_url,
                "provider": updated.provider.value,
                "admin_endpoint": updated.features.admin.endpoint,
                "force_path_style": updated.force_path_style,
                "verify_tls": updated.verify_tls,
            },
        )
        return updated
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)


@router.put("/{endpoint_id}/tags", response_model=StorageEndpoint)
def update_storage_endpoint_tags(
    endpoint_id: int,
    payload: StorageEndpointTagsUpdate,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: User = Depends(get_current_ui_superadmin),
) -> StorageEndpoint:
    try:
        updated = service.update_endpoint_tags(endpoint_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_storage_endpoint_tags",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
            metadata={"tags": serialize_tag_summaries(updated.tags)},
        )
        return updated
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)


@router.put("/{endpoint_id}/default", response_model=StorageEndpoint)
def set_default_storage_endpoint(
    endpoint_id: int,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: User = Depends(get_current_ui_superadmin),
) -> StorageEndpoint:
    try:
        updated = service.set_default_endpoint(endpoint_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="set_default_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
            metadata={
                "endpoint_url": updated.endpoint_url,
                "provider": updated.provider.value,
            },
        )
        return updated
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_storage_endpoint(
    endpoint_id: int,
    service: StorageEndpointsService = Depends(get_service),
    audit_service: AuditService = Depends(get_audit_service),
    current_user: User = Depends(get_current_ui_superadmin),
) -> None:
    try:
        service.delete_endpoint(endpoint_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_storage_endpoint",
            entity_type="storage_endpoint",
            entity_id=str(endpoint_id),
        )
    except ValueError as exc:
        raise_bad_request_or_not_found(exc)
