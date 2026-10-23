# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""OIDC authentication routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.oidc import OIDCCallbackRequest, OIDCProviderInfo, OIDCStartRequest, OIDCStartResponse
from app.routers.auth_common import (
    AuthAttemptContext,
    _finish_user_primary_auth,
    external_identity_link_response,
    settings,
)
from app.routers.auth_request_context import request_context
from app.routers.dependencies import (
    get_audit_service,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.external_identity_user_service import ExternalIdentityLinkRequiredError
from app.services.oidc_service import (
    OIDCAuthenticationError,
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OIDCStateError,
    OidcService,
    get_oidc_service,
)
from app.services.users_service import UsersService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.request_security import require_trusted_origin


router = APIRouter()


def get_oidc_service_dependency(
    db: Session = Depends(get_db),
) -> OidcService:
    return get_oidc_service(db)


@router.get("/oidc/providers", response_model=list[OIDCProviderInfo])
def list_oidc_providers(
    oidc_service: OidcService = Depends(get_oidc_service_dependency),
) -> list[OIDCProviderInfo]:
    return oidc_service.list_providers()


@router.post("/oidc/{provider_id}/start", response_model=OIDCStartResponse)
def start_oidc_login(
    request: Request,
    provider_id: str,
    payload: Optional[OIDCStartRequest] = None,
    oidc_service: OidcService = Depends(get_oidc_service_dependency),
) -> OIDCStartResponse:
    request_origin = require_trusted_origin(request)
    ip_address, _, _ = request_context(request, settings=settings)
    account_key = f"oidc-start:{provider_id.lower()}"
    limiter = AuthRateLimitService(oidc_service.db, settings=settings)
    try:
        limiter.check(account=account_key, ip_address=ip_address)
    except LoginRateLimitedError as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many authentication attempts",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    try:
        result = oidc_service.start_login(
            provider_id,
            payload.redirect_path if payload else None,
            request_origin=request_origin,
        )
        limiter.record_failure(account=account_key, ip_address=ip_address)
        return OIDCStartResponse.model_validate(result)
    except OIDCProviderNotFoundError as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except OIDCConfigurationError as exc:
        limiter.record_failure(account=account_key, ip_address=ip_address)
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


@router.post("/oidc/{provider_id}/callback", response_model=AuthenticationResponse)
def complete_oidc_login(
    request: Request,
    response: Response,
    provider_id: str,
    payload: OIDCCallbackRequest,
    oidc_service: OidcService = Depends(get_oidc_service_dependency),
    users_service: UsersService = Depends(get_users_service_dependency),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    request_origin = require_trusted_origin(request)
    provider = provider_id.lower()
    account_key = f"oidc-callback:{provider}"
    user_email = f"oidc:{provider}"
    attempt = AuthAttemptContext.from_request(
        request=request,
        db=oidc_service.db,
        audit_service=audit_service,
        account_key=account_key,
    )
    attempt.check_rate_limit(
        user_email=user_email,
        entity_type="ui_session",
        audit_message="OIDC login rate limit exceeded",
        public_detail="Too many authentication attempts",
        metadata={"provider": provider},
    )
    try:
        user, redirect_path, created = oidc_service.complete_login(
            provider_id,
            payload.code,
            payload.state,
            request_origin=request_origin,
        )
    except ExternalIdentityLinkRequiredError as exc:
        return external_identity_link_response(
            attempt=attempt,
            user_email=user_email,
            provider_type="oidc",
            provider=provider,
            link_request_id=exc.request_id,
        )
    except OIDCProviderNotFoundError as exc:
        attempt.record_failure(
            user_email=user_email,
            action="login_oidc_failure",
            entity_type="ui_session",
            message="OIDC provider is unavailable",
            metadata={"provider": provider, "error_class": type(exc).__name__},
        )
        raise HTTPException(status_code=404, detail="OIDC provider is unavailable") from exc
    except OIDCStateError as exc:
        error_status = 400
        public_detail = "Invalid OIDC response"
        error_class = type(exc).__name__
    except OIDCConfigurationError as exc:
        error_status = 503
        public_detail = "OIDC provider is unavailable"
        error_class = type(exc).__name__
    except OIDCAuthenticationError as exc:
        error_status = 401
        public_detail = "OIDC authentication failed"
        error_class = type(exc).__name__
    else:
        error_status = None
        public_detail = None
        error_class = None
    if error_status is not None:
        attempt.record_failure(
            user_email=user_email,
            action="login_oidc_failure",
            entity_type="ui_session",
            message=public_detail,
            metadata={"provider": provider, "error_class": error_class},
        )
        raise HTTPException(status_code=error_status, detail=public_detail)
    attempt.clear_rate_limit()
    result = _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="oidc",
        redirect_path=redirect_path,
    )
    attempt.audit(
        user=user,
        action="login_oidc_primary_success",
        entity_type="ui_session",
        metadata={"provider": provider, "created": created, "mfa_status": result.status},
    )
    return result
