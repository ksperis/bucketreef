# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Password and first-administrator authentication routes."""

from __future__ import annotations

from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.auth import AuthenticationResponse
from app.models.first_admin_bootstrap import (
    FirstAdminBootstrapCreate,
    FirstAdminBootstrapStatus,
)
from app.routers.auth_common import AuthAttemptContext, _finish_user_primary_auth
from app.routers.dependencies import (
    get_audit_service,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.first_admin_bootstrap_service import (
    FirstAdminBootstrapError,
    FirstAdminBootstrapService,
    FirstAdminBootstrapUnavailableError,
)
from app.services.users_service import UsersService
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.request_security import require_trusted_origin


router = APIRouter()
bootstrap_router = APIRouter()


@bootstrap_router.get(
    "/bootstrap/first-admin/status",
    response_model=FirstAdminBootstrapStatus,
)
def first_admin_bootstrap_status(
    db: Session = Depends(get_db),
) -> FirstAdminBootstrapStatus:
    return FirstAdminBootstrapStatus(
        available=FirstAdminBootstrapService(db).is_available()
    )


@bootstrap_router.post(
    "/bootstrap/first-admin",
    response_model=AuthenticationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_first_admin_from_bootstrap(
    request: Request,
    response: Response,
    payload: FirstAdminBootstrapCreate,
    bootstrap_token: Optional[str] = Header(
        None,
        alias="X-BucketReef-Bootstrap-Token",
    ),
    users_service: UsersService = Depends(get_users_service_dependency),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    rate_limit_account = "first-admin-bootstrap"
    attempt = AuthAttemptContext.from_request(
        request=request,
        db=users_service.db,
        audit_service=audit_service,
        account_key=rate_limit_account,
    )
    attempt.check_rate_limit(
        user_email=None,
        scope="security",
        action="first_admin_bootstrap_rate_limited",
        entity_type="first_admin_bootstrap",
        audit_message="First administrator bootstrap rate limit exceeded",
        public_detail="Too many bootstrap attempts. Please try again later.",
    )

    try:
        created = FirstAdminBootstrapService(users_service.db).create_with_token(
            token=bootstrap_token or "",
            email=str(payload.email),
            full_name=payload.full_name,
            password=payload.password,
            ip_address=attempt.ip_address,
            user_agent=attempt.user_agent,
            request_id=attempt.request_id,
        )
    except FirstAdminBootstrapUnavailableError as exc:
        attempt.record_failure(
            user_email=str(payload.email).lower(),
            scope="security",
            action="first_admin_bootstrap_failure",
            entity_type="first_admin_bootstrap",
            message="First administrator bootstrap unavailable",
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="First administrator bootstrap is unavailable.",
        ) from exc
    except FirstAdminBootstrapError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    attempt.clear_rate_limit()
    user = users_service.get_by_id(created.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Created administrator is unavailable",
        )
    return _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="bootstrap",
    )



@router.post("/login", response_model=AuthenticationResponse)
def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    users_service: UsersService = Depends(get_users_service_dependency),
    audit_service: AuditService = Depends(get_audit_service),
) -> AuthenticationResponse:
    require_trusted_origin(request)
    username = (form_data.username or "").strip()
    attempt = AuthAttemptContext.from_request(
        request=request,
        db=users_service.db,
        audit_service=audit_service,
        account_key=username,
    )
    attempt.check_rate_limit(
        user_email=username.lower(),
        entity_type="ui_session",
        audit_message="Login rate limit exceeded",
        public_detail="Too many failed login attempts. Please try again later.",
    )
    user = users_service.authenticate(username, form_data.password)
    if not user:
        attempt.record_failure(
            user_email=username.lower(),
            action="login_failure",
            entity_type="ui_session",
            message="Invalid credentials",
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    attempt.clear_rate_limit()
    result = _finish_user_primary_auth(
        request=request,
        response=response,
        user=user,
        users_service=users_service,
        auth_type="password",
    )
    attempt.audit(
        user=user,
        action="login_primary_success",
        entity_type="ui_session",
        metadata={"role": user.role, "mfa_status": result.status},
    )
    return result
