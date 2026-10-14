# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional, Union

from pydantic import Field, field_validator

from app.models.base import ApiModel
from app.utils.resource_names import validate_iam_name
from app.models.policy import InlinePolicy

class IAMUser(ApiModel):
    name: str
    user_id: Optional[str] = None
    arn: Optional[str] = None
    path: Optional[str] = None
    groups: Optional[list[str]] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[str]] = None
    has_keys: bool = False
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None
    is_bucketreef_managed: bool = False
    management_source: Optional[str] = None


class AccessKey(ApiModel):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    secret_access_key: Optional[str] = None
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None
    name: Optional[str] = None
    notes: Optional[str] = None
    expires_at: Optional[datetime] = None
    expiration_state: Optional[str] = None
    expiration_enforced_at: Optional[datetime] = None
    expiration_last_attempt_at: Optional[datetime] = None
    expiration_last_error: Optional[str] = None


class AccessKeyStatusChange(ApiModel):
    active: bool


class IAMUserCreate(ApiModel):
    name: str

    create_key: bool = False
    groups: Optional[list[str]] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[InlinePolicy]] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return validate_iam_name(value, "user")


class IAMUserUpdate(ApiModel):
    name: Optional[str] = None
    path: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        return validate_iam_name(value, "user") if value is not None else value

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: Optional[str]) -> Optional[str]:
        return validate_iam_path(value)


class IAMUserWithKey(IAMUser):
    access_key: Optional[AccessKey] = None


class IAMGroup(ApiModel):
    name: str
    arn: Optional[str] = None
    path: Optional[str] = None
    policies: Optional[list[str]] = None
    is_bucketreef_managed: bool = False
    management_source: Optional[str] = None


class IAMGroupCreate(ApiModel):
    name: str

    inline_policies: Optional[list[InlinePolicy]] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return validate_iam_name(value, "group")


class IAMGroupUpdate(ApiModel):
    name: Optional[str] = None
    path: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> Optional[str]:
        return validate_iam_name(value, "group") if value is not None else value

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: Optional[str]) -> Optional[str]:
        return validate_iam_path(value)


class IAMTag(ApiModel):
    key: str = Field(min_length=1, max_length=128)
    value: str = Field(default="", max_length=256)


class IAMRole(ApiModel):
    name: str
    arn: Optional[str] = None
    path: Optional[str] = None
    policies: Optional[list[str]] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
    max_session_duration: Optional[int] = Field(default=None, ge=3600, le=43200)
    tags: Optional[list[IAMTag]] = None


class IAMRoleCreate(ApiModel):
    name: str

    path: Optional[str] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
    max_session_duration: Optional[int] = Field(default=None, ge=3600, le=43200)
    tags: Optional[list[IAMTag]] = Field(default=None, max_length=50)
    inline_policies: Optional[list[InlinePolicy]] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return validate_iam_name(value, "role")

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: Optional[str]) -> Optional[str]:
        return validate_iam_path(value)


class IAMRoleUpdate(ApiModel):
    path: Optional[str] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
    max_session_duration: Optional[int] = Field(default=None, ge=3600, le=43200)

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: Optional[str]) -> Optional[str]:
        return validate_iam_path(value)


def validate_iam_path(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    if len(value) > 512:
        raise ValueError("IAM path must be at most 512 characters")
    if value == "/":
        return value
    if not value.startswith("/") or not value.endswith("/") or len(value) < 3:
        raise ValueError("IAM path must be '/' or start and end with '/'")
    if any(ord(char) < 0x21 or ord(char) > 0x7E for char in value[1:-1]):
        raise ValueError("IAM path contains unsupported characters")
    return value
