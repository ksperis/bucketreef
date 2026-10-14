# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""One-time conversion of persisted/bootstrap settings to the canonical policy format."""
from copy import deepcopy

from app.models.feature_policy import MANAGER_LEGACY_FIELDS, PORTAL_FEATURE_FIELDS


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
    for field, feature in MANAGER_LEGACY_FIELDS.items():
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
