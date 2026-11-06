# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional, Self

from pydantic import Field, model_validator

from app.models.admin_listing import AdminSortableListingRequest
from app.models.base import ApiModel, reject_explicit_null_fields
from app.models.pagination import PaginatedResponse
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    ManagerToolAccess,
    S3UserMembership,
    UserSummary,
)
from app.models.openstack import LinkedOpenStackCloud

UiGroupAvatarSource = Literal["initials", "preset", "uploaded"]
UiGroupAvatarIcon = Literal["users", "building", "shield", "briefcase", "academic"]
UiGroupSortBy = Literal["name", "created_at", "updated_at"]


class UiGroupListingRequest(AdminSortableListingRequest):
    sort_by: UiGroupSortBy = "name"


class UiGroupAvatar(ApiModel):
    source: UiGroupAvatarSource
    initials: str
    icon: Optional[UiGroupAvatarIcon]
    url: Optional[str]
    updated_at: Optional[datetime]


class LinkedS3Account(ApiModel):
    id: int
    name: str
    rgw_account_id: str


class UiGroupCreate(ApiModel):
    name: str
    description: Optional[str] = None
    avatar_source: UiGroupAvatarSource = "initials"
    avatar_icon: Optional[UiGroupAvatarIcon] = None
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool
    user_ids: list[int] = Field(default_factory=list)
    account_links: list[AccountMembership] = Field(default_factory=list)
    s3_user_links: list[S3UserMembership] = Field(default_factory=list)
    s3_connection_ids: list[int] = Field(default_factory=list)
    openstack_cloud_ids: list[int] = Field(default_factory=list)


class UiGroupUpdate(ApiModel):
    name: Optional[str] = None
    description: Optional[str] = None
    avatar_source: Optional[UiGroupAvatarSource] = None
    avatar_icon: Optional[UiGroupAvatarIcon] = None
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    can_create_manual_private_connections: Optional[bool] = None
    can_provision_managed_private_connections: Optional[bool] = None
    allow_multisite_endpoint_switching: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: Optional[bool] = None
    user_ids: Optional[list[int]] = None
    account_links: Optional[list[AccountMembership]] = None
    s3_user_links: Optional[list[S3UserMembership]] = None
    s3_connection_ids: Optional[list[int]] = None
    openstack_cloud_ids: Optional[list[int]] = None

    @model_validator(mode="after")
    def reject_non_nullable_nulls(self) -> Self:
        reject_explicit_null_fields(
            self,
            (
                "name",
                "avatar_source",
                "can_access_ceph_admin",
                "can_access_storage_ops",
                "can_create_manual_private_connections",
                "can_provision_managed_private_connections",
                "allow_multisite_endpoint_switching",
                "manager_tool_access",
                "browser_advanced_features_enabled",
                "user_ids",
                "account_links",
                "s3_user_links",
                "s3_connection_ids",
                "openstack_cloud_ids",
            ),
        )
        return self


class UiGroupSummary(ApiModel):
    id: int
    name: str
    system_key: Optional[str] = None
    avatar: UiGroupAvatar


class UiGroupOut(ApiModel):
    id: int
    name: str
    system_key: Optional[str]
    description: Optional[str]
    avatar: UiGroupAvatar
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool
    user_details: list[UserSummary]
    account_details: list[LinkedS3Account]
    account_links: list[AccountMembership]
    s3_user_links: list[S3UserMembership]
    s3_user_details: list[LinkedS3User]
    s3_connection_details: list[LinkedS3Connection]
    openstack_cloud_details: list[LinkedOpenStackCloud]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class PaginatedUiGroupsResponse(PaginatedResponse):
    items: list[UiGroupOut]


class PaginatedUiGroupSummariesResponse(PaginatedResponse):
    items: list[UiGroupSummary]
