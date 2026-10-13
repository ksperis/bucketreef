# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from enum import Enum
from pydantic import ConfigDict
from typing import Literal

from app.models.base import ApiModel


class FeaturePolicy(str, Enum):
    DISABLED = "disabled"
    TARGETED = "targeted"
    DEFAULT_ON = "default_on"


class FeaturePolicies(ApiModel):
    model_config = ConfigDict(validate_assignment=True)


class ManagerFeaturePolicies(FeaturePolicies):
    activity_history: FeaturePolicy = FeaturePolicy.DEFAULT_ON
    bucket_compare: FeaturePolicy = FeaturePolicy.TARGETED
    bucket_integrity_check: FeaturePolicy = FeaturePolicy.TARGETED
    bucket_migration: FeaturePolicy = FeaturePolicy.DISABLED
    bucket_purge: FeaturePolicy = FeaturePolicy.DISABLED
    feature_rules: FeaturePolicy = FeaturePolicy.TARGETED
    bucket_quota_management: FeaturePolicy = FeaturePolicy.DISABLED
    ceph_s3_user_keys: FeaturePolicy = FeaturePolicy.TARGETED
    access_key_metadata: FeaturePolicy = FeaturePolicy.TARGETED
    access_key_expiration: FeaturePolicy = FeaturePolicy.TARGETED
    managed_private_connection_provisioning: FeaturePolicy = FeaturePolicy.DISABLED


class PortalFeaturePolicies(FeaturePolicies):
    browser_access: FeaturePolicy = FeaturePolicy.DEFAULT_ON
    private_storage_space_create: FeaturePolicy = FeaturePolicy.DEFAULT_ON
    named_bucket_create: FeaturePolicy = FeaturePolicy.TARGETED
    user_access_key_create: FeaturePolicy = FeaturePolicy.DEFAULT_ON
    user_external_sharing: FeaturePolicy = FeaturePolicy.TARGETED
    server_access_logging: FeaturePolicy = FeaturePolicy.DEFAULT_ON
    storage_space_version_cleanup: FeaturePolicy = FeaturePolicy.DEFAULT_ON


class FeatureState(ApiModel):
    enabled: bool
    source: Literal["platform", "resource", "direct", "group"]
    blocked_reason: str | None = None


def resolve_feature_policy(policy: FeaturePolicy, override: bool | None = None) -> FeatureState:
    """Resolve configuration only; storage and actor authorization still apply."""
    if policy == FeaturePolicy.DISABLED:
        return FeatureState(enabled=False, source="platform", blocked_reason="platform_disabled")
    return FeatureState(
        enabled=override if override is not None else policy == FeaturePolicy.DEFAULT_ON,
        source="resource" if override is not None else "platform",
        blocked_reason="resource_disabled" if override is False else "activation_required" if override is None and policy == FeaturePolicy.TARGETED else None,
    )


MANAGER_LEGACY_FIELDS = {
    "bucket_compare_enabled": "bucket_compare",
    "bucket_integrity_check_enabled": "bucket_integrity_check",
    "bucket_migration_enabled": "bucket_migration",
    "bucket_purge_enabled": "bucket_purge",
    "bucket_quota_management_enabled": "bucket_quota_management",
    "manager_ceph_s3_user_keys_enabled": "ceph_s3_user_keys",
    "manager_access_key_metadata_enabled": "access_key_metadata",
    "manager_access_key_expiration_enabled": "access_key_expiration",
    "managed_private_connection_provisioning_enabled": "managed_private_connection_provisioning",
}

PORTAL_FEATURE_FIELDS = {
    "browser_access_enabled": "browser_access",
    "allow_private_storage_space_create": "private_storage_space_create",
    "allow_portal_named_bucket_create": "named_bucket_create",
    "allow_portal_user_access_key_create": "user_access_key_create",
    "allow_portal_user_external_sharing": "user_external_sharing",
    "server_access_logging_enabled": "server_access_logging",
    "storage_space_version_cleanup_enabled": "storage_space_version_cleanup",
}
