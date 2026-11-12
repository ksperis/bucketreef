# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator

from app.models.access_key_metadata import AccessKeyMetadata
from app.models.admin_listing import AdminManagedEntityListingRequest
from app.models.base import ApiModel, reject_explicit_null_fields
from app.models.managed_resource_features import (
    ManagedS3UserFeatureOverrides,
    ManagedS3UserFeatures,
)
from app.models.quota import QuotaSizeUnit
from app.utils.rgw_identifiers import validate_rgw_user_uid, validate_rgw_tenant
from app.models.pagination import PaginatedResponse
from app.models.tagging import (
    OptionalTagDefinitionList,
    RequiredTagDefinitionList,
    TagDefinitionSummary,
)
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAvatar


class _S3UserAssociationLink(ApiModel):
    allow_manager_browser_data_access: bool


class S3UserUserLink(_S3UserAssociationLink):
    user_id: int
    user_email: Optional[str]
    user_full_name: Optional[str]
    user_avatar: Optional[UserAvatar]


class S3UserGroupLink(_S3UserAssociationLink):
    group_id: int
    group_name: Optional[str]
    group_avatar: Optional[UiGroupAvatar]


class S3UserUserLinkInput(ApiModel):
    user_id: int
    allow_manager_browser_data_access: bool


class S3UserGroupLinkInput(ApiModel):
    group_id: int
    allow_manager_browser_data_access: bool


S3UserSortBy = Literal["name", "uid", "email", "created_at"]


class S3UserListingRequest(AdminManagedEntityListingRequest):
    sort_by: S3UserSortBy = "name"


class S3UserSummary(ManagedS3UserFeatures):
    id: int
    name: str
    rgw_user_uid: str
    rgw_tenant: str
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    tags: list[TagDefinitionSummary]


class S3User(S3UserSummary):
    email: Optional[str]
    created_at: Optional[datetime]
    user_links: list[S3UserUserLink]
    group_links: list[S3UserGroupLink]
    quota_max_size_gb: Optional[float]
    quota_max_objects: Optional[int]
    bucket_count: Optional[int]


class S3UserCreate(ApiModel):
    name: str
    uid: Optional[str] = None
    rgw_tenant: str
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[QuotaSizeUnit] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: int
    tags: RequiredTagDefinitionList = Field(default_factory=list)

    @field_validator("uid")
    @classmethod
    def validate_uid(cls, value: str | None) -> str | None:
        if value and value.strip():
            validate_rgw_user_uid(value)
        return value

    @field_validator("rgw_tenant")
    @classmethod
    def check_tenant(cls, value: str) -> str:
        return validate_rgw_tenant(value)


class S3UserImport(ApiModel):
    uid: str
    rgw_tenant: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: int


class S3UserUpdate(ManagedS3UserFeatureOverrides):
    name: Optional[str] = None
    email: Optional[str] = None
    user_links: Optional[list[S3UserUserLinkInput]] = None
    group_links: Optional[list[S3UserGroupLinkInput]] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[QuotaSizeUnit] = None
    quota_max_objects: Optional[int] = None
    tags: OptionalTagDefinitionList = None

    @model_validator(mode="after")
    def _reject_null_for_non_nullable_updates(self) -> "S3UserUpdate":
        reject_explicit_null_fields(
            self,
            ("name", "user_links", "group_links", "tags"),
        )
        return self

class S3UserAccessKey(AccessKeyMetadata):
    access_key_id: str
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    is_ui_managed: bool = False
    is_active: bool = True
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class S3UserGeneratedKey(AccessKeyMetadata):
    access_key_id: str
    secret_access_key: str
    created_at: Optional[datetime] = None


class PaginatedS3UsersResponse(PaginatedResponse):
    items: list[S3User]
