# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal access-key API contracts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


class PortalAccessKey(ApiModel):
    access_key_id: str
    status: Optional[str]
    created_at: Optional[str]
    is_active: bool
    is_portal: bool
    deletable: bool
    secret_access_key: Optional[str]
    expires_at: Optional[datetime]
    session_token: Optional[str]
    target_type: Literal["self", "external"]
    external_email: Optional[str]
    storage_space_name: Optional[str]
    bucket_name: Optional[str]
    permission: Optional[Literal["read_only", "read_write"]]


class PortalAccessKeyCreate(ApiModel):
    target_type: Literal["self", "external"] = "self"
    storage_space_id: Optional[str] = Field(default=None, min_length=1, max_length=1024)
    external_email: Optional[str] = Field(default=None, max_length=254)
    permission: Optional[Literal["read_only", "read_write"]] = None

    @field_validator("storage_space_id")
    @classmethod
    def _validate_storage_space_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Storage Space is required")
        return cleaned

    @field_validator("external_email")
    @classmethod
    def _validate_external_email(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("External user label is required")
        return cleaned


class PortalAccessKeyStatusChange(ApiModel):
    active: bool


class PortalIAMUser(ApiModel):
    iam_user_id: Optional[str]
    iam_username: Optional[str]
    arn: Optional[str]
    created_at: Optional[datetime]


class PortalAccessKeysState(ApiModel):
    iam_user: PortalIAMUser
    s3_endpoint: Optional[str]
    force_path_style: bool
    access_keys: list[PortalAccessKey]
    can_manage_access_keys: bool
    can_create_external_access: bool
    max_access_keys: int = Field(ge=1)
