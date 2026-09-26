# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.webhook import (
    WebhookDeliveryOut,
    WebhookEndpointCreated,
    WebhookEndpointOut,
    WebhookEndpointPayload,
    WebhookEventDefinition,
    WebhookSecretRotation,
    WebhookTestResponse,
)
from app.routers.dependencies import get_audit_service, get_current_ui_superadmin
from app.services.audit_service import AuditService
from app.services.identity_security_policy import require_admin_sensitive_action
from app.services.webhook_catalog import get_webhook_event_definitions
from app.services.webhook_service import WebhookService, webhook_target_hostname

router = APIRouter(prefix="/admin/settings/webhooks", tags=["admin-webhooks"])


def _service(db: Session) -> WebhookService:
    return WebhookService(db)


def _not_found(exc: LookupError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


def _bad_request(exc: ValueError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.get("", response_model=list[WebhookEndpointOut])
def list_webhook_endpoints(
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> list[WebhookEndpointOut]:
    return _service(db).list_endpoints()


@router.get("/events", response_model=list[WebhookEventDefinition])
def list_webhook_events(
    _: User = Depends(get_current_ui_superadmin),
) -> list[WebhookEventDefinition]:
    return get_webhook_event_definitions()


@router.get("/{endpoint_id}", response_model=WebhookEndpointOut)
def get_webhook_endpoint(
    endpoint_id: int,
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> WebhookEndpointOut:
    try:
        return _service(db).get_endpoint(endpoint_id)
    except LookupError as exc:
        raise _not_found(exc) from exc


@router.post("", response_model=WebhookEndpointCreated, status_code=status.HTTP_201_CREATED)
def create_webhook_endpoint(
    request: Request,
    payload: WebhookEndpointPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> WebhookEndpointCreated:
    require_admin_sensitive_action(request, db, current_user)
    try:
        created = _service(db).create_endpoint(payload)
    except ValueError as exc:
        raise _bad_request(exc) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="webhook_endpoint.create",
        entity_type="webhook_endpoint",
        entity_id=str(created.id),
        metadata={
            "name": created.name,
            "host": webhook_target_hostname(created.url),
            "enabled": created.enabled,
            "event_types": created.event_types,
        },
    )
    return created


@router.put("/{endpoint_id}", response_model=WebhookEndpointOut)
def update_webhook_endpoint(
    endpoint_id: int,
    request: Request,
    payload: WebhookEndpointPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> WebhookEndpointOut:
    require_admin_sensitive_action(request, db, current_user)
    try:
        updated = _service(db).update_endpoint(endpoint_id, payload)
    except LookupError as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise _bad_request(exc) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="webhook_endpoint.update",
        entity_type="webhook_endpoint",
        entity_id=str(updated.id),
        metadata={
            "name": updated.name,
            "host": webhook_target_hostname(updated.url),
            "enabled": updated.enabled,
            "event_types": updated.event_types,
        },
    )
    return updated


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_webhook_endpoint(
    endpoint_id: int,
    request: Request,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, current_user)
    service = _service(db)
    try:
        previous = service.get_endpoint(endpoint_id)
        service.delete_endpoint(endpoint_id)
    except LookupError as exc:
        raise _not_found(exc) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="webhook_endpoint.delete",
        entity_type="webhook_endpoint",
        entity_id=str(endpoint_id),
        metadata={
            "name": previous.name,
            "host": webhook_target_hostname(previous.url),
        },
    )


@router.post("/{endpoint_id}/rotate-secret", response_model=WebhookSecretRotation)
def rotate_webhook_secret(
    endpoint_id: int,
    request: Request,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> WebhookSecretRotation:
    require_admin_sensitive_action(request, db, current_user)
    try:
        result = _service(db).rotate_secret(endpoint_id)
    except LookupError as exc:
        raise _not_found(exc) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="webhook_endpoint.secret.rotate",
        entity_type="webhook_endpoint",
        entity_id=str(endpoint_id),
        metadata={"secret_action": "rotated"},
    )
    return result


@router.post("/{endpoint_id}/test", response_model=WebhookTestResponse, status_code=status.HTTP_202_ACCEPTED)
def test_webhook_endpoint(
    endpoint_id: int,
    request: Request,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> WebhookTestResponse:
    require_admin_sensitive_action(request, db, current_user)
    try:
        result = _service(db).enqueue_test(endpoint_id)
    except LookupError as exc:
        raise _not_found(exc) from exc
    except ValueError as exc:
        raise _bad_request(exc) from exc
    audit.record_action(
        user=current_user,
        scope="admin",
        action="webhook_endpoint.test",
        entity_type="webhook_endpoint",
        entity_id=str(endpoint_id),
        metadata={"delivery_id": result.delivery_id},
    )
    return result


@router.get("/{endpoint_id}/deliveries", response_model=list[WebhookDeliveryOut])
def list_webhook_deliveries(
    endpoint_id: int,
    limit: int = 100,
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> list[WebhookDeliveryOut]:
    try:
        return _service(db).list_deliveries(endpoint_id, limit=limit)
    except LookupError as exc:
        raise _not_found(exc) from exc
