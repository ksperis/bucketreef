# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


class ExternalIdentityLinkProofMethod(ApiModel):
    type: Literal["password", "ldap", "oidc"]
    provider_id: Optional[str] = None
    display_name: Optional[str] = None


class ExternalIdentityLinkStatus(ApiModel):
    attempt_id: str
    target_email: str
    provider_type: Literal["oidc", "ldap"]
    provider_id: str
    source: Literal["login_collision", "profile"]
    stage: Literal[
        "identity",
        "proof",
        "mfa",
        "mfa_enrollment",
        "confirm",
        "admin_requested",
        "admin_approved",
        "admin_rejected",
        "completed",
    ]
    proof_methods: list[ExternalIdentityLinkProofMethod]
    redirect_path: Optional[str] = None
    expires_at: datetime


class ExternalIdentityProfileOidcStartRequest(ApiModel):
    redirect_path: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("redirect_path")
    @classmethod
    def validate_redirect_path(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        path = value.split("?", 1)[0].rstrip("/") or "/"
        allowed_profile_paths = {
            "/profile",
            "/admin/profile",
            "/manager/profile",
            "/portal/profile",
            "/browser/profile",
            "/ceph-admin/profile",
            "/storage-ops/profile",
        }
        if not value.startswith("/") or value.startswith("//") or "#" in value or path not in allowed_profile_paths:
            raise ValueError("redirect_path must target a BucketReef profile route")
        return value


class ExternalIdentityLinkPasswordProof(ApiModel):
    password: str = Field(min_length=1, max_length=4096)


class ExternalIdentityLinkLdapProof(ApiModel):
    provider_id: str = Field(min_length=1, max_length=128)
    username: str = Field(min_length=1, max_length=512)
    password: str = Field(min_length=1, max_length=4096)


class ExternalIdentityLinkMfaRegistrationResult(ApiModel):
    status: ExternalIdentityLinkStatus
    recovery_codes: list[str]
