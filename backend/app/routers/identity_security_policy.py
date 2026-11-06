# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import NoReturn

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.domain_errors import (
    IdentitySecurityAuthorizationError,
    IdentitySecuritySelfActionError,
    ResourceNotFoundError,
)
from app.db import AuthSession, User
from app.core.domain_enums import is_admin_ui_role
from app.routers.dependencies_internal.auth_session import (
    current_auth_session,
    require_recent_mfa,
    require_recent_primary_auth,
)
from app.services.app_settings_service import load_app_settings_for_db
from app.services.identity_security_policy import (
    ensure_actor_can_assign_role as ensure_actor_can_assign_role_service,
    ensure_actor_can_manage_user as ensure_actor_can_manage_user_service,
)
from app.services.identity_security_requirements import passkey_required_for_role
from app.services.webauthn_service import WebAuthnService
from app.utils.http_errors import raise_http_error_from_value_error, raise_http_exception_from_exception


IdentitySecurityRouteError = (
    ResourceNotFoundError
    | IdentitySecuritySelfActionError
    | IdentitySecurityAuthorizationError
)


def require_admin_interactive_session(
    request: Request,
    db: Session,
    actor: User,
) -> AuthSession:
    """Require an authorized administrator using a browser-backed UI session."""
    if not is_admin_ui_role(actor.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return current_auth_session(request, db)


def require_admin_sensitive_action(
    request: Request,
    db: Session,
    actor: User,
) -> None:
    """Require an interactive admin session and, when enabled, recent WebAuthn."""
    session = require_admin_interactive_session(request, db, actor)
    if load_app_settings_for_db(db).general.require_passkey_for_admins:
        if not WebAuthnService(db).is_recent(session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Recent WebAuthn verification required",
            )


def require_self_service_security_action(
    request: Request,
    db: Session,
    user: User,
) -> None:
    """Use WebAuthn when enrolled/required, otherwise recent primary auth."""
    service = WebAuthnService(db)
    if service.has_credentials(user.id) or passkey_required_for_role(db, user.role):
        require_recent_mfa(request, db)
    else:
        require_recent_primary_auth(request, db)


def raise_identity_security_error(exc: IdentitySecurityRouteError) -> NoReturn:
    if isinstance(exc, IdentitySecurityAuthorizationError):
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    raise_http_error_from_value_error(exc)


@contextmanager
def identity_security_http_errors() -> Iterator[None]:
    try:
        yield
    except (
        ResourceNotFoundError,
        IdentitySecuritySelfActionError,
        IdentitySecurityAuthorizationError,
    ) as exc:
        raise_identity_security_error(exc)


def ensure_actor_can_manage_user(
    actor: User,
    target: User,
    *,
    allow_self: bool = False,
) -> None:
    with identity_security_http_errors():
        ensure_actor_can_manage_user_service(actor, target, allow_self=allow_self)


def ensure_actor_can_assign_role(actor: User, role: str) -> None:
    with identity_security_http_errors():
        ensure_actor_can_assign_role_service(actor, role)
