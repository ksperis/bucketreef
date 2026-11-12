# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from app.models.base import ApiModel


class ManagerToolAccess(ApiModel):
    bucket_compare: bool = False
    bucket_integrity_check: bool = False
    bucket_migration: bool = False
    feature_rules: bool = False
    bucket_purge: bool = False


UI_PRINCIPAL_ACCESS_FIELD_NAMES = (
    "can_access_ceph_admin",
    "can_access_storage_ops",
    "can_create_manual_private_connections",
    "can_provision_managed_private_connections",
    "allow_multisite_endpoint_switching",
    "manager_tool_access",
    "browser_advanced_features_enabled",
)


class UiPrincipalAccessFields:
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool


class UiPrincipalAccessPatchFields:
    can_access_ceph_admin: Optional[bool] = None
    can_access_storage_ops: Optional[bool] = None
    can_create_manual_private_connections: Optional[bool] = None
    can_provision_managed_private_connections: Optional[bool] = None
    allow_multisite_endpoint_switching: Optional[bool] = None
    manager_tool_access: Optional[ManagerToolAccess] = None
    browser_advanced_features_enabled: Optional[bool] = None
