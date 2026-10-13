# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Configuration resolution shared by resource editors and execution services."""
from typing import Literal

from app.models.base import ApiModel
from app.db import S3Account, S3User
from app.models.feature_policy import FeaturePolicy, FeatureState, ManagerFeaturePolicies, resolve_feature_policy

MANAGER_RESOURCE_FIELDS = {
    "allow_bucket_quota_management": "bucket_quota_management",
    "allow_access_key_management": "ceph_s3_user_keys",
    "allow_access_key_metadata": "access_key_metadata",
    "allow_access_key_expiration": "access_key_expiration",
    "allow_managed_private_connection_provisioning": "managed_private_connection_provisioning",
}


def manager_override_values(payload: ApiModel) -> dict[str, bool | None]:
    return {field: getattr(payload, field) for field in MANAGER_RESOURCE_FIELDS if field in payload.model_fields_set}


def validate_manager_overrides(payload: ApiModel, policies: ManagerFeaturePolicies, current: S3Account | S3User | None = None) -> None:
    for field, value in manager_override_values(payload).items():
        if (value is True and getattr(policies, MANAGER_RESOURCE_FIELDS[field]) == FeaturePolicy.DISABLED
                and (current is None or getattr(current, field) is not True)):
            raise ValueError("This feature is disabled by the platform")


def manager_resource_states(policies: ManagerFeaturePolicies, resource: S3Account | S3User | None,
                            availability: dict[str, bool],
                            provisioning_source: Literal["platform", "direct", "group"] | None = None) -> dict[str, FeatureState]:
    states = {}
    for field, feature in MANAGER_RESOURCE_FIELDS.items():
        state = resolve_feature_policy(getattr(policies, feature), getattr(resource, field, None))
        if (feature == "managed_private_connection_provisioning" and isinstance(resource, S3Account)
                and getattr(policies, feature) != FeaturePolicy.DISABLED):
            # Account provisioning is authorized by the existing UI grant, not a resource opt-in.
            state = FeatureState(enabled=availability[feature], source=provisioning_source or "platform",
                                 blocked_reason=None if availability[feature] else "prerequisite_or_permission_required")
        if resource is None and state.blocked_reason != "platform_disabled":
            state.enabled = False
            state.blocked_reason = "unsupported_context"
        if state.blocked_reason is None and not availability[feature]:
            state.enabled = False
            state.blocked_reason = "unsupported_context" if resource is None else "prerequisite_or_permission_required"
        states[feature] = state
    return states
