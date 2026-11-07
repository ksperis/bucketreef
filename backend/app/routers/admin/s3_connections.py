# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.domain_errors import (
    S3ConnectionConflictError,
    S3ConnectionNotFoundError,
)
from app.db import (
    S3Connection,
    User,
)
from app.models.s3_connection import (
    S3ConnectionCredentialsValidationRequest,
    S3ConnectionCredentialsValidationResult,
)
from app.models.s3_connection_admin import (
    PaginatedS3ConnectionsResponse,
    S3ConnectionAdminCreate,
    S3ConnectionAdminItem,
    S3ConnectionAdminListingRequest,
    S3ConnectionAdminUpdate,
)
from app.routers.dependencies import get_audit_service, get_current_ui_admin
from app.routers.identity_security_policy import require_admin_sensitive_action
from app.services.audit_service import AuditService
from app.services.admin_s3_connections_read_service import AdminS3ConnectionsReadService
from app.services.identity_security_policy import (
    admin_s3_connection_update_requires_step_up,
)
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_connections_service import (
    S3ConnectionsService,
)
from app.services.s3_connection_validation_service import S3ConnectionValidationService
from app.services.tags_service import serialize_tag_summaries
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import (
    resolve_connection_details,
)
from app.utils.http_errors import (
    raise_http_error_from_value_error,
)
router = APIRouter(prefix="/admin/s3-connections", tags=["admin-s3-connections"])
logger = logging.getLogger(__name__)


def _get_admin_shared_connection(db: Session, connection_id: int) -> S3Connection:
    try:
        return S3ConnectionsService(db).get_admin_shared(connection_id)
    except S3ConnectionNotFoundError as exc:
        raise_http_error_from_value_error(exc)


@router.get("", response_model=PaginatedS3ConnectionsResponse)
def list_s3_connections(
    query: Annotated[S3ConnectionAdminListingRequest, Query()],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_admin),
) -> PaginatedS3ConnectionsResponse:
    _ = current_user
    return AdminS3ConnectionsReadService(db).list(query)


@router.post("/validate-credentials", response_model=S3ConnectionCredentialsValidationResult)
def validate_s3_connection_credentials(
    payload: S3ConnectionCredentialsValidationRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_ui_admin),
) -> S3ConnectionCredentialsValidationResult:
    service = S3ConnectionValidationService(db)
    try:
        return service.validate_credentials(payload)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


@router.post("", response_model=S3ConnectionAdminItem, status_code=status.HTTP_201_CREATED)
def create_s3_connection(
    request: Request,
    payload: S3ConnectionAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_admin),
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionAdminItem:
    service = S3ConnectionsService(db)
    tags_service = service.tags
    require_admin_sensitive_action(request, db, current_user)
    try:
        conn = service.create_admin_shared(current_user.id, payload)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
    details = resolve_connection_details(conn)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.create",
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata={
                "name": conn.name,
                "endpoint_url": details.endpoint_url,
                "provider_hint": details.provider,
                "is_shared": True,
                "created_by_user_id": conn.created_by_user_id,
                "access_manager": conn.access_manager,
                "access_browser": conn.access_browser,
                "can_manage_iam": s3_connection_can_manage_iam(conn.capabilities),
                "access_key_id": mask_access_key_id(conn.access_key_id),
                "tags": serialize_tag_summaries(tags_service.get_connection_tags(conn)),
            },
        )
    return AdminS3ConnectionsReadService(db).item(
        conn,
        created_by_user=current_user,
        include_links=False,
    )


@router.patch("/{connection_id}", response_model=S3ConnectionAdminItem)
def update_s3_connection(
    request: Request,
    connection_id: int,
    payload: S3ConnectionAdminUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_admin),
    audit: AuditService = Depends(get_audit_service),
) -> S3ConnectionAdminItem:
    service = S3ConnectionsService(db)
    conn = _get_admin_shared_connection(db, connection_id)
    if admin_s3_connection_update_requires_step_up(db, conn, payload):
        require_admin_sensitive_action(request, db, current_user)
    try:
        conn = service.update_admin_shared(conn, payload)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
    audit_metadata = payload.model_dump(
        exclude_unset=True,
        exclude={"credentials"},
    )
    if payload.credentials is not None:
        audit_metadata["access_key_id"] = mask_access_key_id(
            payload.credentials.access_key_id
        )
        audit_metadata["credentials_updated"] = True
    audit.record_action(
        user=current_user,
        scope="admin",
        action=(
            "connection.remediate"
            if payload.remediation_action == "activate_manager"
            else "connection.update"
        ),
        entity_type="s3_connection",
        entity_id=str(conn.id),
        metadata=audit_metadata,
    )
    return AdminS3ConnectionsReadService(db).item(conn)


@router.delete(
    "/{connection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_s3_connection(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_ui_admin),
    audit: AuditService = Depends(get_audit_service),
) -> Response:
    service = S3ConnectionsService(db)
    conn = _get_admin_shared_connection(db, connection_id)
    details = resolve_connection_details(conn)
    meta = {"name": conn.name, "endpoint_url": details.endpoint_url, "provider_hint": details.provider}
    try:
        service.delete_admin_shared(conn)
    except S3ConnectionConflictError as exc:
        raise_http_error_from_value_error(exc)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="connection.delete",
        entity_type="s3_connection",
        entity_id=str(connection_id),
        metadata=meta,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
