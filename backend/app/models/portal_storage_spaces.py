# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal storage-space API contracts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, ValidationInfo, field_validator, model_validator

from app.models.base import ApiModel, reject_explicit_null_fields
from app.models.user import UserAvatar
from app.utils.resource_names import validate_s3_bucket_name


PortalStorageSpaceRole = Literal["Viewer", "Editor", "Owner", "Manager"]
PortalStorageSpaceStatus = Literal["Active", "Attention", "Archived"]
PortalStorageSpaceSort = Literal[
    "name",
    "-name",
    "created_at",
    "-created_at",
    "used_bytes",
    "-used_bytes",
    "object_count",
    "-object_count",
    "role",
    "-role",
    "status",
    "-status",
]
PortalStorageSpaceGrantRole = Literal["Viewer", "Editor"]
PortalStorageSpaceOrigin = Literal["portal_generic", "portal_named", "imported"]
PortalStorageSpaceNamingMode = Literal["generic_uuid", "named_bucket"]
PortalStorageSpaceVisibility = Literal["private", "shared"]
PortalStorageSpaceShareScope = Literal["restricted", "account"]
PortalStorageSpaceAccountMemberRole = Literal["Viewer", "Editor"]
PortalStorageSpaceIconSource = Literal["preset", "uploaded"]
PortalStorageSpaceIconPreset = Literal["bucket", "folder", "archive", "database", "media"]


class PortalStorageSpaceCollaboratorPreview(ApiModel):
    user_id: int
    email: str
    display_name: Optional[str]
    role: PortalStorageSpaceRole
    avatar: UserAvatar


class PortalStorageSpaceIcon(ApiModel):
    source: PortalStorageSpaceIconSource
    preset: Optional[PortalStorageSpaceIconPreset]
    url: Optional[str]
    updated_at: Optional[datetime]


class PortalStorageSpaceIconChoice(ApiModel):
    source: PortalStorageSpaceIconSource
    preset: Optional[PortalStorageSpaceIconPreset] = None


class PortalStorageSpaceListingRequest(ApiModel):
    search: Optional[str] = Field(default=None, description="Filter storage spaces by name")
    role: Optional[PortalStorageSpaceRole] = Field(default=None, description="Filter by simple Portal role")
    status: Optional[PortalStorageSpaceStatus] = Field(
        default=None,
        description="Filter by simple Storage Space status",
    )
    sort: PortalStorageSpaceSort = Field(
        default="name",
        description="Sort by name, created_at, used_bytes, object_count, role, or status",
    )
    include_archived: bool = Field(default=False, description="Include archived Storage Spaces")


class PortalStorageSpaceSummary(ApiModel):
    id: str
    name: str
    role: PortalStorageSpaceRole
    can_browse: bool
    can_take_ownership: bool
    can_delete: bool
    status: PortalStorageSpaceStatus
    description: Optional[str]
    owner_label: Optional[str]
    owner_user_id: Optional[int]
    collaborators: list[PortalStorageSpaceCollaboratorPreview]
    collaborator_count: int
    visibility: PortalStorageSpaceVisibility
    share_scope: PortalStorageSpaceShareScope
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole]
    project_key: Optional[str]
    dataset_label: Optional[str]
    region: Optional[str]
    created_at: Optional[datetime]
    used_bytes: Optional[int]
    object_count: Optional[int]
    quota_max_size_bytes: Optional[int]
    quota_max_objects: Optional[int]
    internal_bucket_name: Optional[str]
    archived_at: Optional[datetime]
    origin: PortalStorageSpaceOrigin
    name_editable: bool
    icon: PortalStorageSpaceIcon


class PortalStorageSpaceInitialShare(ApiModel):
    user_id: int
    role: PortalStorageSpaceGrantRole


class _PortalStorageSpaceProvisioningOptions(ApiModel):
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: PortalStorageSpaceVisibility
    share_scope: PortalStorageSpaceShareScope
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole]
    initial_shares: list[PortalStorageSpaceInitialShare]
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)


class PortalStorageSpaceCreate(_PortalStorageSpaceProvisioningOptions):
    naming_mode: PortalStorageSpaceNamingMode
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str, info: ValidationInfo) -> str:
        if info.data.get("naming_mode") == "named_bucket":
            return validate_s3_bucket_name(value)
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Storage Space name is required")
        return cleaned


class PortalStorageSpaceImport(_PortalStorageSpaceProvisioningOptions):
    bucket_name: str = Field(min_length=1, max_length=63)

    @field_validator("bucket_name")
    @classmethod
    def _validate_bucket_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Bucket name is required")
        return cleaned


class PortalStorageSpaceUpdate(ApiModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    share_scope: Optional[PortalStorageSpaceShareScope] = None
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)
    archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Storage Space name is required")
        return cleaned

    @model_validator(mode="after")
    def _reject_null_for_non_nullable_updates(self) -> "PortalStorageSpaceUpdate":
        reject_explicit_null_fields(self, ("name", "share_scope", "archived"))
        return self
