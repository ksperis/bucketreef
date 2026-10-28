# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal, Optional

from pydantic import EmailStr, field_validator

from app.models.account_access import AccountAccessGrant
from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.models.openstack import LinkedOpenStackCloud
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue

UiLanguage = Literal["en", "fr", "de", "zh"]
UiThemePreference = Literal["light", "dark"]
UiRole = Literal["ui_superadmin", "ui_admin", "ui_user", "ui_none"]
UserAvatarPreference = Literal["auto", "uploaded", "gravatar", "initials"]
UserAvatarSource = Literal["uploaded", "provider", "gravatar", "initials"]
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
    allow_manager_browser_data_access: bool = False


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


class UserCreate(ApiModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    role: Optional[UiRole] = None
    can_access_ceph_admin: bool = False
    can_access_storage_ops: bool = False
    can_create_manual_private_connections: bool = False
    can_provision_managed_private_connections: bool = False
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: bool = False
    group_ids: Optional[list[int]] = None
    openstack_cloud_ids: Optional[list[int]] = None


class UserProfilePreferencesUpdate(ApiModel):
    avatar_preference: Optional[UserAvatarPreference] = None
    ui_language: Optional[UiLanguage] = None
    quota_alerts_enabled: Optional[bool] = None
    quota_alerts_global_watch: Optional[bool] = None


class UserUpdate(UserProfilePreferencesUpdate):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[UiRole] = None
    is_active: Optional[bool] = None
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    can_create_manual_private_connections: Optional[bool] = None
    can_provision_managed_private_connections: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: Optional[bool] = None
    account_links: Optional[list[AccountMembership]] = None
    s3_user_links: Optional[list[S3UserMembership]] = None
    s3_connection_ids: Optional[list[int]] = None
    group_ids: Optional[list[int]] = None
    openstack_cloud_ids: Optional[list[int]] = None


class UserSelfUpdate(UserProfilePreferencesUpdate):
    full_name: Optional[str] = None
    ui_preferences: Optional[UiPreferences] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class EffectiveUserAccess(ApiModel):
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
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
