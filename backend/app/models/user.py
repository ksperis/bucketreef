# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional, Self

from pydantic import EmailStr, Field, field_validator, model_validator

from app.models.account_access import AccountAccessGrant
from app.models.admin_listing import AdminPaginatedListingRequest, AdminSortDir
from app.models.base import ApiModel, reject_explicit_null_fields
from app.models.pagination import PaginatedResponse
from app.models.openstack import LinkedOpenStackCloud
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue

UiLanguage = Literal["en", "fr", "de", "zh"]
UiThemePreference = Literal["light", "dark"]
UiRole = Literal["ui_superadmin", "ui_admin", "ui_user", "ui_none"]
UserAvatarPreference = Literal["auto", "uploaded", "gravatar", "initials"]
UserAvatarSource = Literal["uploaded", "provider", "gravatar", "initials"]
AdminUserSortBy = Literal["name", "role", "accounts", "last_login_at"]
MIN_PASSWORD_LENGTH = 12
PASSWORD_POLICY_ERROR = f"Password must be at least {MIN_PASSWORD_LENGTH} characters long"


def validate_password_policy(password: str) -> None:
    value = str(password or "")
    if len(value) < MIN_PASSWORD_LENGTH or not value.strip():
        raise ValueError(PASSWORD_POLICY_ERROR)


class LinkedS3User(ApiModel):
    id: int
    name: str


class LinkedS3Connection(ApiModel):
    id: int
    name: str


class LinkedUiGroup(ApiModel):
    id: int
    name: str


class AccountMembership(AccountAccessGrant):
    account_id: int


class S3UserMembership(ApiModel):
    s3_user_id: int
    allow_manager_browser_data_access: bool


class UserAssociationsPayload(ApiModel):
    account_links: Optional[list[AccountMembership]] = None
    s3_user_links: Optional[list[S3UserMembership]] = None
    s3_connection_ids: Optional[list[int]] = None
    group_ids: Optional[list[int]] = None
    openstack_cloud_ids: Optional[list[int]] = None


class UserCreateAssociationsPayload(UserAssociationsPayload):
    account_links: list[AccountMembership] = Field(default_factory=list)
    s3_user_links: list[S3UserMembership] = Field(default_factory=list)
    s3_connection_ids: list[int] = Field(default_factory=list)
    group_ids: list[int] = Field(default_factory=list)
    openstack_cloud_ids: list[int] = Field(default_factory=list)


class EffectiveAccountGroupSource(ApiModel):
    group_id: int
    group_name: str
    manager_role: Optional[ManagerAccountRoleValue]
    portal_role: Optional[PortalAccountRoleValue]
    determines_effective_manager_role: bool
    determines_effective_portal_role: bool
    allow_manager_browser_data_access: bool


class EffectiveAccountRoleProvenance(ApiModel):
    direct_manager_role: Optional[ManagerAccountRoleValue]
    direct_portal_role: Optional[PortalAccountRoleValue]
    direct_determines_effective_manager_role: bool
    direct_determines_effective_portal_role: bool
    direct_allow_manager_browser_data_access: bool
    groups: list[EffectiveAccountGroupSource]


class EffectiveAccountMembership(AccountMembership):
    provenance: EffectiveAccountRoleProvenance


class ManagerToolAccess(ApiModel):
    bucket_compare: bool = False
    bucket_integrity_check: bool = False
    bucket_migration: bool = False
    feature_rules: bool = False
    bucket_purge: bool = False


class UserCreateAccessPayload(UserCreateAssociationsPayload):
    role: UiRole
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool


class UiPreferences(ApiModel):
    theme: Optional[UiThemePreference] = None
    selected_portal_account_id: Optional[str] = None

    @field_validator("selected_portal_account_id")
    @classmethod
    def normalize_selected_portal_account_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class UserAvatar(ApiModel):
    preference: UserAvatarPreference
    source: UserAvatarSource
    url: Optional[str]
    initials: str
    updated_at: Optional[datetime]


class UserSummary(ApiModel):
    id: int
    email: EmailStr
    full_name: Optional[str]
    avatar: Optional[UserAvatar]
    role: UiRole


class UserAssociationDetail(ApiModel):
    id: int
    email: str
    full_name: Optional[str]
    avatar: Optional[UserAvatar]


class UserCreate(UserCreateAccessPayload):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class UserProfilePreferencesUpdate(ApiModel):
    avatar_preference: Optional[UserAvatarPreference] = None
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: Optional[bool] = None
    quota_alerts_global_watch: Optional[bool] = None

    @model_validator(mode="after")
    def reject_non_nullable_profile_nulls(self) -> Self:
        reject_explicit_null_fields(
            self,
            (
                "avatar_preference",
                "quota_alerts_enabled",
                "quota_alerts_global_watch",
            ),
        )
        return self


class UserUpdate(UserProfilePreferencesUpdate, UserAssociationsPayload):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[UiRole] = None
    is_active: Optional[bool] = None
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    can_create_manual_private_connections: Optional[bool] = None
    can_provision_managed_private_connections: Optional[bool] = None
    allow_multisite_endpoint_switching: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: Optional[bool] = None

    @model_validator(mode="after")
    def reject_non_nullable_nulls(self) -> Self:
        reject_explicit_null_fields(
            self,
            (
                "email",
                "password",
                "role",
                "is_active",
                "can_access_ceph_admin",
                "can_access_storage_ops",
                "can_create_manual_private_connections",
                "can_provision_managed_private_connections",
                "allow_multisite_endpoint_switching",
                "manager_tool_access",
                "browser_advanced_features_enabled",
                "account_links",
                "s3_user_links",
                "s3_connection_ids",
                "group_ids",
                "openstack_cloud_ids",
            ),
        )
        return self


class UserSelfUpdate(UserProfilePreferencesUpdate):
    full_name: Optional[str] = None
    ui_preferences: Optional[UiPreferences] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None

    @model_validator(mode="after")
    def reject_non_nullable_nulls(self) -> Self:
        reject_explicit_null_fields(
            self,
            (
                "ui_preferences",
                "current_password",
                "new_password",
            ),
        )
        return self


class EffectiveUserAccess(ApiModel):
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    group_can_provision_managed_private_connections: bool
    has_owned_private_connections: bool
    manager_tool_access: ManagerToolAccess
    group_manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool
    account_links: list[EffectiveAccountMembership]
    s3_user_details: list[LinkedS3User]
    s3_connection_details: list[LinkedS3Connection]


class UserOut(ApiModel):
    id: int
    email: str
    full_name: Optional[str]
    picture_url: Optional[str]
    avatar: UserAvatar
    has_local_password: bool
    is_active: bool
    is_admin: bool
    role: UiRole
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool
    ui_language: Optional[UiLanguage]
    quota_alerts_enabled: bool
    quota_alerts_global_watch: bool
    ui_preferences: UiPreferences
    account_links: list[AccountMembership]
    group_details: list[LinkedUiGroup]
    s3_user_links: list[S3UserMembership]
    s3_user_details: list[LinkedS3User]
    s3_connection_details: list[LinkedS3Connection]
    openstack_cloud_details: list[LinkedOpenStackCloud]
    effective_access: EffectiveUserAccess
    last_login_at: Optional[datetime]


class PaginatedUsersResponse(PaginatedResponse):
    items: list[UserOut]


class AdminUserListingRequest(AdminPaginatedListingRequest):
    sort_by: AdminUserSortBy = "name"
    sort_dir: AdminSortDir = "asc"


class PaginatedUserSummariesResponse(PaginatedResponse):
    items: list[UserSummary]
