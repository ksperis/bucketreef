# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""One-time conversion of bootstrap settings to the canonical policy format."""
from copy import deepcopy

from app.models.feature_policy import PORTAL_FEATURE_FIELDS


LEGACY_MANAGER_FEATURE_FIELDS = {
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


def normalize_settings_import(payload: dict) -> dict:
    result = deepcopy(payload)
    general = result.setdefault("general", {})
    project_policies = general.setdefault("project_feature_policies", {})
    if "bucket_usage_stats_enabled" in general:
        value = general.pop("bucket_usage_stats_enabled")
        if not isinstance(value, bool):
            raise ValueError("Legacy setting bucket_usage_stats_enabled must be a boolean")
        project_policies.setdefault("bucket_usage_stats", "default_on" if value else "disabled")
    manager = result.setdefault("manager", {})
    policies = manager.setdefault("feature_policies", {})
    if "manager_rgw_usage_metrics_enabled" in manager:
        value = manager.pop("manager_rgw_usage_metrics_enabled")
        if not isinstance(value, bool):
            raise ValueError("Legacy setting manager_rgw_usage_metrics_enabled must be a boolean")
        policies.setdefault("rgw_usage_metrics", "default_on" if value else "disabled")
    for field, feature in LEGACY_MANAGER_FEATURE_FIELDS.items():
        if field in general:
            value = general.pop(field)
            if not isinstance(value, bool):
                raise ValueError(f"Legacy setting {field} must be a boolean")
            policies.setdefault(feature, "targeted" if value else "disabled")
    portal = result.setdefault("portal", {})
    portal_policies = portal.setdefault("feature_policies", {})
    for field, feature in PORTAL_FEATURE_FIELDS.items():
        if field in portal:
            value = portal.pop(field)
            if not isinstance(value, bool):
                raise ValueError(f"Legacy setting {field} must be a boolean")
            portal_policies.setdefault(feature, "default_on" if value else "targeted")
    return result
