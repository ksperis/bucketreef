# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""OIDC authentication routes."""

from __future__ import annotations

from typing import NoReturn, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.oidc import OIDCCallbackRequest, OIDCProviderInfo, OIDCStartRequest, OIDCStartResponse
from app.routers.auth_common import (
    AuthAttemptContext,
    _finish_user_primary_auth,
    external_identity_link_response,
    external_identity_reauthentication_response,
    settings,
)
from app.routers.auth_cookies import (
    ensure_external_identity_browser_binding,
    external_identity_browser_binding_hash,
)
from app.routers.auth_request_context import request_context
from app.routers.dependencies import (
    get_audit_service,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.external_identity_user_service import (
    ExternalIdentityLinkRequiredError,
    ExternalIdentityReauthenticationRequiredError,
)
from app.services.oidc_service import (
    OIDCAuthenticationError,
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OIDCStateError,
    OIDCLinkContinuationRequiredError,
    OidcService,
    get_oidc_service,
)
from app.services.users_service import UsersService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.identity_provider_ids import normalize_identity_provider_id
from app.utils.request_security import require_trusted_origin


router = APIRouter()


def get_oidc_service_dependency(
    db: Session = Depends(get_db),
) -> OidcService:
    return get_oidc_service(db)


def _raise_oidc_login_failure(
    *,
    attempt: AuthAttemptContext,
    user_email: str,
    provider: str,
    exc: Exception,
    status_code: int,
    public_detail: str,
) -> NoReturn:
    attempt.record_failure(
        user_email=user_email,
        action="login_oidc_failure",
        entity_type="ui_session",
        message=public_detail,
        metadata={"provider": provider, "error_class": type(exc).__name__},
    )
    raise HTTPException(status_code=status_code, detail=public_detail) from exc


@router.get("/oidc/providers", response_model=list[OIDCProviderInfo])
def list_oidc_providers(
    oidc_service: OidcService = Depends(get_oidc_service_dependency),
) -> list[OIDCProviderInfo]:
    return oidc_service.list_providers()


@router.post("/oidc/{provider_id}/start", response_model=OIDCStartResponse)
def start_oidc_login(
    request: Request,
    response: Response,
    provider_id: str,
    payload: Optional[OIDCStartRequest] = None,
    oidc_service: OidcService = Depends(get_oidc_service_dependency),
) -> OIDCStartResponse:
    request_origin = require_trusted_origin(request)
    ip_address, _, _ = request_context(request, settings=settings)
    try:
        provider = normalize_identity_provider_id(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="OIDC provider is unavailable") from exc
    account_key = f"oidc-start:{provider}"
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
        _, browser_secret_hash = ensure_external_identity_browser_binding(request, response)
        result = oidc_service.start_login(
            provider,
            payload.redirect_path if payload else None,
            request_origin=request_origin,
            browser_secret_hash=browser_secret_hash,
        )
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
    try:
        provider = normalize_identity_provider_id(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="OIDC provider is unavailable") from exc
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
            provider,
            payload.code,
            payload.state,
            request_origin=request_origin,
            browser_secret_hash=external_identity_browser_binding_hash(request),
        )
    except (ExternalIdentityReauthenticationRequiredError, OIDCLinkContinuationRequiredError) as exc:
        return external_identity_reauthentication_response(
            attempt=attempt,
            link_attempt_id=exc.attempt_id,
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
        _raise_oidc_login_failure(
            attempt=attempt,
            user_email=user_email,
            provider=provider,
            exc=exc,
            status_code=status.HTTP_404_NOT_FOUND,
            public_detail="OIDC provider is unavailable",
        )
    except OIDCStateError as exc:
        _raise_oidc_login_failure(
            attempt=attempt,
            user_email=user_email,
            provider=provider,
            exc=exc,
            status_code=status.HTTP_400_BAD_REQUEST,
            public_detail="Invalid OIDC response",
        )
    except OIDCConfigurationError as exc:
        _raise_oidc_login_failure(
            attempt=attempt,
            user_email=user_email,
            provider=provider,
            exc=exc,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            public_detail="OIDC provider is unavailable",
        )
    except OIDCAuthenticationError as exc:
        _raise_oidc_login_failure(
            attempt=attempt,
            user_email=user_email,
            provider=provider,
            exc=exc,
            status_code=status.HTTP_401_UNAUTHORIZED,
            public_detail="OIDC authentication failed",
        )
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
