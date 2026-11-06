# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Annotated, Optional, Union

from pydantic import AfterValidator, Field, model_validator

from app.models.access_key_metadata import AccessKeyMetadata
from app.models.base import ApiModel, reject_explicit_null_fields
from app.utils.resource_names import validate_iam_name
from app.models.policy import InlinePolicy, Policy


def validate_iam_path(value: str) -> str:
    if len(value) > 512:
        raise ValueError("IAM path must be at most 512 characters")
    if value == "/":
        return value
    if not value.startswith("/") or not value.endswith("/") or len(value) < 3:
        raise ValueError("IAM path must be '/' or start and end with '/'")
    if any(ord(char) < 0x21 or ord(char) > 0x7E for char in value[1:-1]):
        raise ValueError("IAM path contains unsupported characters")
    return value


def _validate_iam_user_name(value: str) -> str:
    return validate_iam_name(value, "user")


def _validate_iam_group_name(value: str) -> str:
    return validate_iam_name(value, "group")


def _validate_iam_role_name(value: str) -> str:
    return validate_iam_name(value, "role")


_IAMUserName = Annotated[str, AfterValidator(_validate_iam_user_name)]
_IAMGroupName = Annotated[str, AfterValidator(_validate_iam_group_name)]
_IAMRoleName = Annotated[str, AfterValidator(_validate_iam_role_name)]
_IAMPath = Annotated[str, AfterValidator(validate_iam_path)]


class IAMOverview(ApiModel):
    iam_users: int
    iam_groups: int
    iam_roles: int
    iam_policies: int
    warnings: list[str]


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


class AccessKey(AccessKeyMetadata):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[str] = None
    secret_access_key: Optional[str] = None
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class IAMUserCreate(ApiModel):
    name: _IAMUserName

    create_key: bool
    groups: list[str]
    policies: list[str]
    inline_policies: list[InlinePolicy]


class IAMUserUpdate(ApiModel):
    name: Optional[_IAMUserName] = None
    path: Optional[_IAMPath] = None

    @model_validator(mode="after")
    def _reject_null_updates(self) -> "IAMUserUpdate":
        reject_explicit_null_fields(self, ("name", "path"))
        return self


class IAMUserWithKey(IAMUser):
    access_key: Optional[AccessKey] = None


class IAMGroup(ApiModel):
    name: str
    arn: Optional[str] = None
    path: Optional[str] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[str]] = None
    members: Optional[list[str]] = None
    is_bucketreef_managed: bool = False
    management_source: Optional[str] = None


class IAMGroupCreate(ApiModel):
    name: _IAMGroupName

    policies: list[str]
    inline_policies: list[InlinePolicy]


class IAMGroupUpdate(ApiModel):
    name: Optional[_IAMGroupName] = None
    path: Optional[_IAMPath] = None

    @model_validator(mode="after")
    def _reject_null_updates(self) -> "IAMGroupUpdate":
        reject_explicit_null_fields(self, ("name", "path"))
        return self


class IAMTag(ApiModel):
    key: str = Field(min_length=1, max_length=128)
    value: str = Field(default="", max_length=256)


class IAMRole(ApiModel):
    name: str
    arn: Optional[str] = None
    path: Optional[str] = None
    policies: Optional[list[str]] = None
    inline_policies: Optional[list[str]] = None
    assume_role_policy_document: Optional[Union[dict, str]] = None
    max_session_duration: Optional[int] = Field(default=None, ge=3600, le=43200)
    tags: Optional[list[IAMTag]] = None


class IAMRoleCreate(ApiModel):
    name: _IAMRoleName

    path: Optional[_IAMPath] = None
    assume_role_policy_document: Union[dict, str]
    max_session_duration: Optional[int] = Field(default=None, ge=3600, le=43200)
    tags: Optional[list[IAMTag]] = Field(default=None, max_length=50)
    policies: list[str]
    inline_policies: list[InlinePolicy]


class IAMRoleUpdate(ApiModel):
    assume_role_policy_document: Optional[Union[dict, str]] = None
    max_session_duration: Optional[int] = Field(default=None, ge=3600, le=43200)

    @model_validator(mode="after")
    def _reject_null_updates(self) -> "IAMRoleUpdate":
        reject_explicit_null_fields(
            self,
            ("assume_role_policy_document", "max_session_duration"),
        )
        return self


class IAMPageRequest(ApiModel):
    marker: Optional[str] = None
    page_size: int = Field(default=25, ge=1, le=100)
    search: Optional[str] = Field(default=None, max_length=200)


class IAMDetailedPageRequest(IAMPageRequest):
    include_details: bool = False


class IAMUserPage(ApiModel):
    items: list[IAMUser]
    next_marker: Optional[str] = None


class IAMGroupPage(ApiModel):
    items: list[IAMGroup]
    next_marker: Optional[str] = None


class IAMRolePage(ApiModel):
    items: list[IAMRole]
    next_marker: Optional[str] = None


class IAMPolicyPage(ApiModel):
    items: list[Policy]
    next_marker: Optional[str] = None
