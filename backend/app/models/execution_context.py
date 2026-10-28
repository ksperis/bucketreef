# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Literal

from app.models.base import ApiModel
from app.models.feature_policy import FeatureState
from app.models.tagging import TagDefinitionSummary
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue

ManagerAccessMode = Literal["admin", "session", "s3_user", "connection", "openstack_project"]
ManagerContextKind = Literal["account", "connection", "openstack_project"]


class ExecutionContextCapabilities(ApiModel):
    can_manage_iam: bool
    sts_capable: bool
    admin_api_capable: bool


class OpenStackExecutionContextMetadata(ApiModel):
    connection_id: str
    cloud_name: str
    identity_name: str
    project_id: str
    project_name: str
    region_id: str


class ExecutionContext(ApiModel):
    kind: Literal["account", "connection", "s3_user", "portal_account", "openstack_project"]
    id: str
    display_name: str
    connection_scope: Optional[Literal["shared", "private"]]
    manager_role: Optional[ManagerAccountRoleValue]
    portal_role: Optional[PortalAccountRoleValue]
    rgw_account_id: Optional[str]
    endpoint_id: Optional[int]
    endpoint_name: str
    endpoint_is_default: bool
    endpoint_provider: Optional[Literal["ceph", "aws", "other"]]
    endpoint_url: str
    storage_endpoint_capabilities: dict[str, bool]
    tags: list[TagDefinitionSummary]
    endpoint_tags: list[TagDefinitionSummary]
    capabilities: ExecutionContextCapabilities
    openstack: Optional[OpenStackExecutionContextMetadata] = None


class ManagerContext(ApiModel):
    feature_states: dict[str, FeatureState]
    naming_validation_profile: Literal["ceph", "standard"]
    access_mode: ManagerAccessMode
    context_kind: ManagerContextKind
    iam_identity: Optional[str]
    manager_stats_enabled: bool
    manager_stats_message: Optional[str]
    manager_browser_enabled: bool
    manager_browser_message: Optional[str]
    manager_bucket_quota_enabled: bool
    manager_ceph_keys_enabled: bool
    manager_access_key_metadata_enabled: bool
    manager_access_key_expiration_enabled: bool
    manager_private_access_enabled: bool
    quota_max_size_gb: Optional[float]
    quota_max_objects: Optional[int]
    max_buckets: Optional[int]
    max_users: Optional[int]
    max_roles: Optional[int]
    max_groups: Optional[int]


class WorkspaceAvailability(ApiModel):
    available: bool
    context_count: int


class WorkspaceAccess(ApiModel):
    openstack_connect_available: bool = False
    admin: WorkspaceAvailability
    ceph_admin: WorkspaceAvailability
    storage_ops: WorkspaceAvailability
    manager: WorkspaceAvailability
    browser: WorkspaceAvailability
    portal: WorkspaceAvailability
    default_workspace: Optional[Literal["admin", "ceph-admin", "storage-ops", "manager", "portal", "browser"]]
