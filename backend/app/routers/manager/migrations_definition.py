# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Manager bucket-migration definition and precheck routes."""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import BucketMigration
from app.services.access_context_contracts import BucketMigrationAccessScope
from app.models.bucket_migration import (
    BucketMigrationCreateRequest,
    BucketMigrationDetail,
    BucketMigrationDraftRequest,
    BucketMigrationPrecheckRequest,
    BucketMigrationUpdateRequest,
)
from app.routers.dependencies import (
    get_audit_service,
    get_current_bucket_migration_scope,
)
from app.services.audit_service import AuditService
from app.services.bucket_migration.runtime import (
    build_bucket_migration_detail,
    build_bucket_migration_service,
    wake_bucket_migration_worker,
)
from app.utils.http_errors import (
    raise_http_error_from_value_error,
    raise_http_exception_from_exception,
)

router = APIRouter(prefix="/manager/migrations", tags=["manager-migrations"])


def _migration_definition_audit_metadata(
    payload: BucketMigrationDraftRequest,
    migration: BucketMigration,
) -> dict[str, object]:
    return {
        "source_context_id": payload.source_context_id,
        "target_context_id": payload.target_context_id,
        "mode": payload.mode,
        "lock_target_writes": payload.lock_target_writes,
        "strong_integrity_check": payload.strong_integrity_check,
        "use_same_endpoint_copy": migration.use_same_endpoint_copy,
        "auto_grant_source_read_for_copy": migration.auto_grant_source_read_for_copy,
        "items": len(payload.buckets),
    }


@router.delete(
    "/{migration_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response
)
def delete_migration(
    migration_id: int,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> Response:
    current_user = scope.user
    service = build_bucket_migration_service(db, scope)
    try:
        service.delete_migration(migration_id)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="delete_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration_id),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "", response_model=BucketMigrationDetail, status_code=status.HTTP_201_CREATED
)
def create_migration(
    payload: BucketMigrationCreateRequest,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationDetail:
    current_user = scope.user
    service = build_bucket_migration_service(db, scope)
    try:
        migration = service.create_migration(payload, current_user)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="create_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata=_migration_definition_audit_metadata(payload, migration),
    )
    return build_bucket_migration_detail(service, migration, events_limit=200)


@router.put("/{migration_id}", response_model=BucketMigrationDetail)
def update_migration(
    migration_id: int,
    payload: BucketMigrationUpdateRequest,
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationDetail:
    current_user = scope.user
    service = build_bucket_migration_service(db, scope)
    try:
        migration = service.update_draft_migration(migration_id, payload)
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="update_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata=_migration_definition_audit_metadata(payload, migration),
    )
    return build_bucket_migration_detail(service, migration, events_limit=200)


@router.post(
    "/{migration_id}/precheck",
    response_model=BucketMigrationDetail,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_migration_precheck(
    migration_id: int,
    payload: BucketMigrationPrecheckRequest = Body(
        default_factory=BucketMigrationPrecheckRequest
    ),
    db: Session = Depends(get_db),
    scope: BucketMigrationAccessScope = Depends(get_current_bucket_migration_scope),
    audit: AuditService = Depends(get_audit_service),
) -> BucketMigrationDetail:
    current_user = scope.user
    service = build_bucket_migration_service(db, scope)
    try:
        migration = service.request_precheck(
            migration_id, active_checks=payload.active_checks
        )
        wake_bucket_migration_worker()
    except PermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)

    audit.record_action(
        user=current_user,
        scope="manager",
        action="precheck_bucket_migration",
        entity_type="bucket_migration",
        entity_id=str(migration.id),
        metadata={
            "active_checks": payload.active_checks,
            "configuration_revision": migration.configuration_revision,
        },
    )
    return build_bucket_migration_detail(service, migration, events_limit=200)
