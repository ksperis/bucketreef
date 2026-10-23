# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal storage-space API contracts."""

from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, ValidationInfo, field_validator

from app.models.base import ApiModel
from app.models.user import UserAvatar
from app.utils.resource_names import validate_s3_bucket_name


PortalStorageSpaceRole = Literal["Viewer", "Editor", "Owner", "Manager"]
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


class PortalStorageSpaceSummary(ApiModel):
    id: str
    name: str
    role: PortalStorageSpaceRole
    can_browse: bool
    can_take_ownership: bool
    can_delete: bool
    status: str
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


class PortalStorageSpaceCreate(ApiModel):
    naming_mode: PortalStorageSpaceNamingMode = "generic_uuid"
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: PortalStorageSpaceVisibility = "private"
    share_scope: PortalStorageSpaceShareScope = "restricted"
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    initial_shares: list[PortalStorageSpaceInitialShare] = Field(default_factory=list)
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str, info: ValidationInfo) -> str:
        if info.data.get("naming_mode") == "named_bucket":
            return validate_s3_bucket_name(value)
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Storage Space name is required")
        return cleaned


class PortalStorageSpaceImport(ApiModel):
    bucket_name: str = Field(min_length=1, max_length=63)
    description: Optional[str] = Field(default=None, max_length=2000)
    visibility: PortalStorageSpaceVisibility = "private"
    share_scope: PortalStorageSpaceShareScope = "restricted"
    account_member_role: Optional[PortalStorageSpaceAccountMemberRole] = None
    initial_shares: list[PortalStorageSpaceInitialShare] = Field(default_factory=list)
    project_key: Optional[str] = Field(default=None, max_length=80)
    dataset_label: Optional[str] = Field(default=None, max_length=120)

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
    visibility: Optional[PortalStorageSpaceVisibility] = None
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
