# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""LDAP authentication routes."""

from __future__ import annotations

from typing import NoReturn

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.ldap import LDAPLoginRequest, LDAPProviderInfo
from app.routers.auth_common import (
    AuthAttemptContext,
    _finish_user_primary_auth,
    external_identity_link_response,
    external_identity_reauthentication_response,
)
from app.routers.auth_cookies import ensure_external_identity_browser_binding
from app.routers.dependencies import (
    get_audit_service,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.external_identity_user_service import (
    ExternalIdentityLinkRequiredError,
    ExternalIdentityReauthenticationRequiredError,
)
from app.services.ldap_service import (
    LDAPAuthenticationError,
    LDAPAuthService,
    LDAPConfigurationError,
    LDAPProviderNotFoundError,
    LDAPUserConflictError,
    get_ldap_auth_service,
)
from app.services.users_service import UsersService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.identity_provider_ids import normalize_identity_provider_id
from app.utils.request_security import require_trusted_origin


router = APIRouter()


def get_ldap_auth_service_dependency(
    db: Session = Depends(get_db),
) -> LDAPAuthService:
    return get_ldap_auth_service(db)


def _raise_ldap_login_failure(
    *,
    attempt: AuthAttemptContext,
    account_key: str,
    provider: str,
    exc: LDAPProviderNotFoundError | LDAPConfigurationError | LDAPAuthenticationError | LDAPUserConflictError,
) -> NoReturn:
    if isinstance(exc, LDAPProviderNotFoundError):
        attempt.audit(
            user=None,
            user_email=account_key,
            action="login_ldap_provider_not_found",
            entity_type="ui_session",
            status_value="failure",
            message="LDAP provider is unavailable",
            metadata={"provider": provider},
        )
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    if isinstance(exc, LDAPConfigurationError):
        attempt.audit(
            user=None,
            user_email=account_key,
            action="login_ldap_configuration_error",
            entity_type="ui_session",
            status_value="failure",
            message="LDAP provider configuration error",
            metadata={"provider": provider},
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="LDAP provider is unavailable",
        ) from exc
    attempt.record_failure(
        user_email=account_key,
        action="login_failure",
        entity_type="ui_session",
        message="Invalid LDAP credentials",
        metadata={"provider": provider},
    )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
    ) from exc


@router.get("/ldap/providers", response_model=list[LDAPProviderInfo])
def list_ldap_providers(
    ldap_service: LDAPAuthService = Depends(get_ldap_auth_service_dependency),
) -> list[LDAPProviderInfo]:
    return ldap_service.list_providers()


@router.post("/ldap/{provider_id}/login", response_model=AuthenticationResponse)
def login_with_ldap(
    request: Request,
    response: Response,
    provider_id: str,
    payload: LDAPLoginRequest,
    users_service: UsersService = Depends(get_users_service_dependency),
    ldap_service: LDAPAuthService = Depends(get_ldap_auth_service_dependency),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    username = (payload.username or "").strip()
    try:
        provider = normalize_identity_provider_id(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="LDAP provider not found") from exc
    account_key = f"ldap:{provider}:{username.lower()}"
    attempt = AuthAttemptContext.from_request(
        request=request,
        db=users_service.db,
        audit_service=audit_service,
        account_key=account_key,
    )
    attempt.check_rate_limit(
        user_email=account_key,
        entity_type="ui_session",
        audit_message="LDAP login rate limit exceeded",
        public_detail="Too many failed login attempts",
    )
    _, browser_secret_hash = ensure_external_identity_browser_binding(request, response)
    try:
        user, created = ldap_service.authenticate(
            provider,
            username,
            payload.password,
            browser_secret_hash=browser_secret_hash,
        )
    except ExternalIdentityReauthenticationRequiredError as exc:
        return external_identity_reauthentication_response(
            attempt=attempt,
            link_attempt_id=exc.attempt_id,
        )
    except ExternalIdentityLinkRequiredError as exc:
        return external_identity_link_response(
            attempt=attempt,
            user_email=account_key,
            provider_type="ldap",
            provider=provider,
            link_request_id=exc.request_id,
        )
    except (
        LDAPProviderNotFoundError,
        LDAPConfigurationError,
        LDAPAuthenticationError,
        LDAPUserConflictError,
    ) as exc:
        _raise_ldap_login_failure(
            attempt=attempt,
            account_key=account_key,
            provider=provider,
            exc=exc,
        )
    attempt.clear_rate_limit()
    result = _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="ldap",
    )
    attempt.audit(
        user=user,
        action="login_ldap_primary_success",
        entity_type="ui_session",
        metadata={"provider": provider, "created": created, "mfa_status": result.status},
    )
    return result
