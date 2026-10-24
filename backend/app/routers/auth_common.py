# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared UI authentication completion helpers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import User
from app.models.auth import AuthenticationResponse
from app.models.audit import AuditStatus
from app.routers.auth_cookies import set_auth_cookies, set_pre_auth_cookie
from app.routers.auth_request_context import request_context
from app.services.audit_service import AuditService
from app.services.auth_rate_limit_service import AuthRateLimitService, LoginRateLimitedError
from app.services.primary_authentication_service import PrimaryAuthenticationService
from app.services.users_service import UsersService

settings = get_settings()


@dataclass
class AuthAttemptContext:
    account_key: str
    ip_address: str
    user_agent: Optional[str]
    request_id: Optional[str]
    limiter: AuthRateLimitService
    audit_service: AuditService

    @classmethod
    def from_request(
        cls,
        *,
        request: Request,
        db: Session,
        audit_service: AuditService,
        account_key: str,
    ) -> "AuthAttemptContext":
        ip_address, user_agent, request_id = request_context(request, settings=settings)
        return cls(
            account_key=account_key,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            limiter=AuthRateLimitService(db, settings=settings),
            audit_service=audit_service,
        )

    def audit(
        self,
        *,
        user: Optional[User],
        action: str,
        entity_type: str,
        scope: str = "auth",
        entity_id: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
        status_value: AuditStatus = "success",
        message: Optional[str] = None,
        user_email: Optional[str] = None,
        user_role: Optional[str] = None,
    ) -> None:
        self.audit_service.record_action(
            user=user,
            user_email=user_email,
            user_role=user_role,
            scope=scope,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            metadata=metadata,
            status=status_value,
            message=message,
            ip_address=self.ip_address,
            user_agent=self.user_agent,
            request_id=self.request_id,
        )

    def check_rate_limit(
        self,
        *,
        user_email: Optional[str],
        entity_type: str,
        audit_message: str,
        public_detail: str,
        scope: str = "auth",
        action: str = "login_rate_limited",
        user_role: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        try:
            self.limiter.check(account=self.account_key, ip_address=self.ip_address)
        except LoginRateLimitedError as exc:
            self.audit(
                user=None,
                user_email=user_email,
                user_role=user_role,
                scope=scope,
                action=action,
                entity_type=entity_type,
                status_value="failure",
                message=audit_message,
                metadata=metadata,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=public_detail,
                headers={"Retry-After": str(exc.retry_after)},
            ) from exc

    def record_failure(
        self,
        *,
        user_email: Optional[str],
        action: str,
        entity_type: str,
        message: str,
        scope: str = "auth",
        user_role: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> None:
        self.limiter.record_failure(account=self.account_key, ip_address=self.ip_address)
        self.audit(
            user=None,
            user_email=user_email,
            user_role=user_role,
            scope=scope,
            action=action,
            entity_type=entity_type,
            status_value="failure",
            message=message,
            metadata=metadata,
        )

    def clear_rate_limit(self) -> None:
        self.limiter.clear_account(account=self.account_key, ip_address=self.ip_address)


def external_identity_link_response(
    *,
    attempt: AuthAttemptContext,
    user_email: str,
    provider_type: str,
    provider: str,
    link_request_id: str,
) -> AuthenticationResponse:
    attempt.clear_rate_limit()
    attempt.audit(
        user=None,
        user_email=user_email,
        action="external_identity_link_requested",
        entity_type="external_identity_link_request",
        entity_id=link_request_id,
        metadata={"provider_type": provider_type, "provider": provider},
    )
    return AuthenticationResponse(
        status="link_approval_required",
        user=None,
        session=None,
        redirect_path=None,
        recovery_codes=None,
    )


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
