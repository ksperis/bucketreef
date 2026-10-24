# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Direct S3 credential authentication routes."""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.session import S3KeyLogin, SessionDescriptor
from app.routers.auth_common import AuthAttemptContext, settings
from app.routers.auth_cookies import set_auth_cookies
from app.routers.dependencies import get_audit_service
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionService
from app.services.session_service import SessionIntrospectionError, SessionService
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.request_security import require_trusted_origin
from app.utils.s3_endpoint import validate_custom_login_s3_endpoint


router = APIRouter()


@router.post("/login-s3", response_model=AuthenticationResponse)
def login_with_s3_keys(
    request: Request,
    response: Response,
    payload: S3KeyLogin,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    general = load_app_settings_for_db_readonly(db).general
    if not general.allow_login_access_keys:
        raise HTTPException(status_code=403, detail="Access-key login is disabled")
    service = get_storage_endpoints_service(db)
    registered = {endpoint.endpoint_url for endpoint in service.list_endpoints()}
    endpoint_url = payload.endpoint_url or service.get_default_endpoint_url()
    custom_endpoint = endpoint_url not in registered
    if settings.require_registered_s3_login_endpoints or not general.allow_login_custom_endpoint:
        if endpoint_url not in registered:
            raise HTTPException(status_code=400, detail="S3 endpoint is not registered")
    elif endpoint_url not in registered:
        try:
            endpoint_url = validate_custom_login_s3_endpoint(endpoint_url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid S3 endpoint") from exc
    account_key = f"s3:{hashlib.sha256(payload.access_key.encode()).hexdigest()}"
    attempt = AuthAttemptContext.from_request(
        request=request,
        db=db,
        audit_service=audit_service,
        account_key=account_key,
    )
    attempt.check_rate_limit(
        user_email="s3:unknown",
        user_role="s3_session",
        entity_type="s3_session",
        audit_message="S3 login rate limit exceeded",
        public_detail="Too many failed login attempts",
    )
    session_service = SessionService(db)
    try:
        actor_type, account_id, account_name, user_uid, capabilities = session_service.introspect_credentials(
            payload.access_key,
            payload.secret_key,
            endpoint_url,
        )
    except SessionIntrospectionError as exc:
        attempt.record_failure(
            user_email="s3:unknown",
            user_role="s3_session",
            action="login_s3_failure",
            entity_type="s3_session",
            message="Invalid credentials",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials") from exc
    attempt.clear_rate_limit()
    principal = session_service.create_session(
        access_key=payload.access_key,
        secret_key=payload.secret_key,
        actor_type=actor_type,
        account_id=account_id,
        account_name=account_name,
        user_uid=user_uid,
        capabilities=capabilities,
    )
    credentials = AuthSessionService(db).create_for_s3_session_id(
        principal.session_id,
        ip_address=attempt.ip_address,
        user_agent=attempt.user_agent,
    )
    set_auth_cookies(response, credentials)
    descriptor = SessionDescriptor(
        actor_type=principal.actor_type,
        account_id=principal.account_id,
        account_name=principal.account_name,
        capabilities=principal.capabilities,
    )
    attempt.audit(
        user=None,
        user_email=principal.email,
        user_role=principal.role,
        action="login_s3_custom_endpoint" if custom_endpoint else "login_s3",
        entity_type="s3_session",
        entity_id=principal.session_id,
        metadata={
            "actor_type": principal.actor_type,
            "account_id": principal.account_id,
            **({"endpoint_url": endpoint_url} if custom_endpoint else {}),
        },
    )
    return AuthenticationResponse(
        status="authenticated",
        user=None,
        session=descriptor,
        redirect_path=None,
        recovery_codes=None,
    )
