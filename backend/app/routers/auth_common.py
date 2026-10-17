# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared UI authentication completion helpers."""

from __future__ import annotations

from typing import Optional

from fastapi import Request, Response

from app.core.config import get_settings
from app.db import User
from app.models.auth import AuthenticationResponse
from app.routers.auth_cookies import set_auth_cookies, set_pre_auth_cookie
from app.routers.auth_request_context import request_context
from app.services.primary_authentication_service import PrimaryAuthenticationService
from app.services.users_service import UsersService

settings = get_settings()


def _finish_user_primary_auth(
    *,
    request: Request,
    response: Response,
    user: User,
    users_service: UsersService,
    auth_type: str,
    redirect_path: Optional[str] = None,
) -> AuthenticationResponse:
    service = PrimaryAuthenticationService(users_service)
    completion = service.pre_auth_completion(
        user,
        redirect_path=redirect_path,
    )
    if completion is not None and completion.pre_auth_purpose is not None:
        set_pre_auth_cookie(response, user, completion.pre_auth_purpose)
        return completion.response

    ip_address, user_agent, _ = request_context(request, settings=settings)
    completion = service.authenticated_completion(
        user,
        auth_type=auth_type,
        ip_address=ip_address,
        user_agent=user_agent,
        redirect_path=redirect_path,
    )
    if completion.session_credentials is not None:
        set_auth_cookies(response, completion.session_credentials)
    return completion.response
