# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from app.db import User
from app.models.auth import AuthenticationResponse
from app.services.auth_session_service import AuthSessionService, SessionCredentials
from app.services.identity_security_policy import passkey_required_for_role
from app.services.users_service import UsersService
from app.services.webauthn_service import WebAuthnService


PreAuthPurpose = Literal["mfa_authentication", "mfa_enrollment"]


@dataclass(frozen=True)
class PrimaryAuthenticationCompletion:
    response: AuthenticationResponse
    session_credentials: SessionCredentials | None = None
    pre_auth_purpose: PreAuthPurpose | None = None


class PrimaryAuthenticationService:
    def __init__(self, users_service: UsersService) -> None:
        self.users_service = users_service

    def pre_auth_completion(
        self,
        user: User,
        *,
        redirect_path: Optional[str] = None,
    ) -> PrimaryAuthenticationCompletion | None:
        has_passkey = WebAuthnService(self.users_service.db).has_credentials(user.id)
        if has_passkey or passkey_required_for_role(self.users_service.db, user.role):
            pre_auth_purpose: PreAuthPurpose = (
                "mfa_authentication" if has_passkey else "mfa_enrollment"
            )
            return PrimaryAuthenticationCompletion(
                response=AuthenticationResponse(
                    status="mfa_required" if has_passkey else "mfa_enrollment_required",
                    user=self.users_service.user_to_out(user),
                    session=None,
                    redirect_path=redirect_path,
                    recovery_codes=None,
                ),
                pre_auth_purpose=pre_auth_purpose,
            )
        return None

    def authenticated_completion(
        self,
        user: User,
        *,
        auth_type: str,
        ip_address: Optional[str],
        user_agent: Optional[str],
        redirect_path: Optional[str] = None,
    ) -> PrimaryAuthenticationCompletion:
        credentials = AuthSessionService(self.users_service.db).create_for_user(
            user,
            auth_type=auth_type,
            ip_address=ip_address,
            user_agent=user_agent,
            mfa_verified=False,
        )
        return PrimaryAuthenticationCompletion(
            response=AuthenticationResponse(
                status="authenticated",
                user=self.users_service.user_to_out(user),
                session=None,
                redirect_path=redirect_path,
                recovery_codes=None,
            ),
            session_credentials=credentials,
        )
