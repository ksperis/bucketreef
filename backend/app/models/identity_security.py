# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import EmailStr, Field

from app.models.base import ApiModel
from app.models.auth import SessionInfo
from app.models.user import UiRole


class AdminPasskeyInfo(ApiModel):
    id: str
    name: str
    created_at: datetime
    last_used_at: Optional[datetime]
    revoked_at: Optional[datetime]


class AdminSessionInfo(SessionInfo):
    user_email: Optional[str]
    user_full_name: Optional[str]
    user_role: Optional[UiRole]


class AdminExternalIdentityInfo(ApiModel):
    id: str
    provider_type: Literal["oidc", "ldap"]
    provider_id: str
    subject: str
    email: Optional[str]
    email_verified: bool
    link_source: str
    created_at: datetime
    last_login_at: Optional[datetime]
    revoked_at: Optional[datetime]


class AdminUserSecurity(ApiModel):
    user_id: int
    email: str
    role: UiRole
    has_local_password: bool
    passkey_required: bool
    passkeys: list[AdminPasskeyInfo]
    external_identities: list[AdminExternalIdentityInfo]
    sessions: list[SessionInfo]


class AdminSetPasswordRequest(ApiModel):
    password: str = Field(min_length=1, max_length=1024)


class AdminExternalIdentityRequest(ApiModel):
    provider_type: Literal["oidc", "ldap"]
    provider_id: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=2048)
    email: Optional[EmailStr] = None
    email_verified: bool = False
    restore: bool = False


class AdminMfaResetResponse(ApiModel):
    user_id: int
    passkey_enrollment_required: bool
    passkeys_removed: int
    recovery_codes_removed: int
    challenges_removed: int


class ExternalIdentityLinkRequestInfo(ApiModel):
    id: str
    user_id: int
    user_email: str
    user_role: UiRole
    provider_type: str
    provider_id: str
    email: str
    status: str
    created_at: datetime
    expires_at: datetime
    decided_at: Optional[datetime]
    decision_source: Optional[str]


class ExternalIdentityLinkDecisionResponse(ApiModel):
    id: str
    status: Literal["approved", "rejected"]
