# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.db.openstack import OpenStackCloud, OpenStackConnection
from app.models.openstack import (
    OpenStackActivate, OpenStackAuthenticate, OpenStackCloudPublic,
    OpenStackCloudWrite, OpenStackConnectionRead, OpenStackContextRead, OpenStackProjectAccessRead,
    OpenStackPrivateConnectionCreate, OpenStackProjectOptionsRead, OpenStackProjectRead,
)
from app.models.s3_connection import S3Connection
from app.routers.dependencies import get_current_account_user
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.auth_session_guards import current_auth_session
from app.services.effective_access_service import EffectiveAccessService
from app.services.openstack_service import OpenStackService
from app.services.keystone_client import OpenStackError

router = APIRouter(prefix="/me/openstack", tags=["openstack"])


def ui_session(request: Request, response: Response, db: Session = Depends(get_db), user: User = Depends(get_current_account_user)):
    response.headers["Cache-Control"] = "no-store"
    if request.headers.get("authorization"):
        raise HTTPException(403, "An interactive UI session is required")
    row = current_auth_session(request, db)
    if row.principal_type != "user" or row.user_id != user.id:
        raise HTTPException(403, "An interactive UI session is required")
    return row


def cloud_read(row: OpenStackCloud) -> dict:
    return {
        **{key: getattr(row, key) for key in OpenStackCloudWrite.model_fields},
        "id": row.id,
    }


def _record_action(db, user, action, entity, entity_id):
    AuditService(db).record_action(user=user, scope="admin" if entity == "OpenStackCloud" else "auth",
                                  action=action, entity_type=entity, entity_id=str(entity_id))


@router.get("/clouds", response_model=list[OpenStackCloudPublic])
def available_clouds(db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    return [dict(id=row.id, name=row.name, allow_password=row.allow_password, allow_token=row.allow_token,
                 default_domain=row.default_domain)
            for row in OpenStackService(db).allowed_clouds(user)]


@router.get("/connections", response_model=list[OpenStackConnectionRead])
def connections(db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    service = OpenStackService(db)
    return [service.connection_read(row, user, session.id) for row in db.scalars(select(OpenStackConnection).where(OpenStackConnection.user_id == user.id)).all()]


@router.post("/connections", response_model=OpenStackConnectionRead)
def connect(payload: OpenStackAuthenticate, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    limiter = AuthRateLimitService(db)
    account = "openstack:" + hashlib.sha256(f"{user.id}:{payload.cloud_id}:{payload.username or payload.user_id or 'token'}".encode()).hexdigest()
    ip = request.client.host if request.client else None
    try:
        limiter.check(account=account, ip_address=ip)
    except LoginRateLimitedError as exc:
        raise HTTPException(429, "Too many authentication attempts", headers={"Retry-After": str(exc.retry_after)}) from None
    service = OpenStackService(db)
    try:
        connection = service.authenticate(user, session.id, payload)
    except OpenStackError as exc:
        if exc.code in {"reauthentication_required", "access_denied", "unsupported_token"}:
            limiter.record_failure(account=account, ip_address=ip)
            _record_action(db, user, "openstack.connect.failure", "OpenStackCloud", payload.cloud_id)
        raise
    limiter.clear_account(account=account, ip_address=ip)
    _record_action(db, user, "openstack.connect", "OpenStackConnection", connection.id)
    return service.connection_read(connection, user, session.id)


@router.get("/project-options", response_model=OpenStackProjectOptionsRead)
def project_options(db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    return OpenStackService(db).project_options(user, session.id)


@router.get("/connections/{connection_id}/projects", response_model=list[OpenStackProjectRead])
def projects(connection_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    return OpenStackService(db).projects(user, session.id, connection_id)


@router.get("/connections/{connection_id}/projects/{project_id}/access", response_model=OpenStackProjectAccessRead)
def project_access(connection_id: str, project_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    access = OpenStackService(db).project_access(user, session.id, connection_id, project_id)
    return {
        "targets": access["targets"],
        "access_keys": [key["access"] for key in access["credentials"]],
        "selected_access_key": access["selected_access_key"],
    }


@router.post(
    "/connections/{connection_id}/projects/{project_id}/private-connections",
    response_model=S3Connection,
    status_code=status.HTTP_201_CREATED,
)
def create_private_connection(
    connection_id: str,
    project_id: str,
    payload: OpenStackPrivateConnectionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_account_user),
    session=Depends(ui_session),
):
    if not EffectiveAccessService(db).resolve_user(user).can_create_manual_private_connections:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manual private S3 connection creation is not allowed for this user",
        )
    try:
        created = OpenStackService(db).create_private_connection(
            user,
            session.id,
            connection_id,
            project_id,
            payload,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    AuditService(db).record_action(
        user=user,
        scope="auth",
        action="connection.create.openstack",
        entity_type="S3Connection",
        entity_id=str(created.id),
        metadata={
            "openstack_connection_id": connection_id,
            "project_id": project_id,
            "target_id": payload.target_id,
            "region": created.region,
            "access_key_id": payload.access_key,
            "access_manager": created.access_manager,
            "access_browser": created.access_browser,
        },
    )
    return created

@router.post("/connections/{connection_id}/contexts", response_model=OpenStackContextRead)
def activate(connection_id: str, payload: OpenStackActivate, db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    context_id = OpenStackService(db).activate(user, session.id, connection_id, payload.project_id, payload.target_id, payload.access_key)
    _record_action(db, user, "openstack.context.activate", "OpenStackProjectContext", context_id)
    return {"context_id": context_id}


@router.delete("/connections/{connection_id}/session", status_code=204)
def disconnect(connection_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    OpenStackService(db).disconnect(user, session.id, connection_id)
    _record_action(db, user, "openstack.disconnect", "OpenStackConnection", connection_id)


@router.delete("/connections/{connection_id}", status_code=204)
def forget(connection_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_account_user), session=Depends(ui_session)):
    OpenStackService(db).disconnect(user, session.id, connection_id, forget=True)
    _record_action(db, user, "openstack.connection.forget", "OpenStackConnection", connection_id)
