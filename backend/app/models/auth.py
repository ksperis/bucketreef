# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.session import SessionDescriptor
from app.models.user import UserOut


class AuthenticationResponse(ApiModel):
    status: Literal[
        "authenticated",
        "mfa_required",
        "mfa_enrollment_required",
        "link_approval_required",
    ]
    user: Optional[UserOut]
    session: Optional[SessionDescriptor]
    redirect_path: Optional[str]
    link_request_id: Optional[str]
    recovery_codes: Optional[list[str]]


class RefreshResponse(ApiModel):
    status: Literal["authenticated"]


class SessionInfo(ApiModel):
    id: str
    principal_type: str
    auth_type: str
    created_at: datetime
    last_activity_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    mfa_verified_at: Optional[datetime]
    ip_address: Optional[str]
    user_agent: Optional[str]
    revoked_at: Optional[datetime]
    revoke_reason: Optional[str]
    current: bool
    user_id: Optional[int]
    s3_session_id: Optional[str]


class CurrentSessionResponse(ApiModel):
    authenticated: Literal[True]
    user: Optional[UserOut]
    session: Optional[SessionDescriptor]
    auth_session: SessionInfo


class WebAuthnCredentialRequest(ApiModel):
    credential: dict[str, Any]
    name: str = Field(default="Passkey", min_length=1, max_length=128)


class WebAuthnAuthenticationRequest(ApiModel):
    credential: dict[str, Any]


class RecentWebAuthnVerificationResponse(ApiModel):
    mfa_verified_at: datetime


class RecoveryCodeRequest(ApiModel):
    code: str = Field(min_length=8, max_length=128)


class LinkDecisionRequest(ApiModel):
    approve: bool
    reason: Optional[str] = Field(default=None, max_length=500)


class WebAuthnCredentialInfo(ApiModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime]


class WebAuthnCredentialCreatedResponse(ApiModel):
    id: str
    name: str
    reauthentication_required: Literal[True]


class RecoveryCodesResponse(ApiModel):
    codes: list[str]


class ExternalIdentityInfo(ApiModel):
    id: str
    provider_type: str
    provider_id: str
    email: Optional[str]
    email_verified: bool
    created_at: datetime
    last_login_at: Optional[datetime]
