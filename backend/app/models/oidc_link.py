# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel


class OidcLinkProofMethod(ApiModel):
    type: Literal["password", "ldap", "oidc"]
    provider_id: Optional[str] = None
    display_name: Optional[str] = None


class OidcLinkStatus(ApiModel):
    attempt_id: str
    target_email: str
    provider_id: str
    source: Literal["login_collision", "profile"]
    stage: Literal[
        "oidc",
        "proof",
        "mfa",
        "mfa_enrollment",
        "confirm",
        "admin_requested",
        "admin_approved",
        "admin_rejected",
        "completed",
    ]
    proof_methods: list[OidcLinkProofMethod]
    expires_at: datetime


class OidcLinkPasswordProof(ApiModel):
    password: str = Field(min_length=1, max_length=4096)


class OidcLinkLdapProof(ApiModel):
    provider_id: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=512)
    password: str = Field(min_length=1, max_length=4096)


class OidcLinkMfaRegistrationResult(ApiModel):
    status: OidcLinkStatus
    recovery_codes: list[str]
