# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import NoReturn

from fastapi import status

from app.core.domain_errors import (
    IdentitySecurityAuthorizationError,
    IdentitySecuritySelfActionError,
    ResourceNotFoundError,
)
from app.db import User
from app.services.identity_security_policy import (
    ensure_actor_can_assign_role as ensure_actor_can_assign_role_service,
    ensure_actor_can_manage_user as ensure_actor_can_manage_user_service,
)
from app.utils.http_errors import raise_http_error_from_value_error, raise_http_exception_from_exception


IdentitySecurityRouteError = (
    ResourceNotFoundError
    | IdentitySecuritySelfActionError
    | IdentitySecurityAuthorizationError
)


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
