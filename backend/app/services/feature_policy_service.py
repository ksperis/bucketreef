# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Configuration resolution shared by resource editors and execution services."""
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.base import ApiModel
from app.db import S3Account, S3Connection, S3User
from app.models.feature_policy import (
    FeaturePolicy,
    FeatureState,
    ManagerFeaturePolicies,
    ProjectCollectionPolicies,
    ProjectFeaturePolicies,
    resolve_feature_policy,
)
from app.services.s3_execution_context import S3ExecutionContext

MANAGER_RESOURCE_FIELDS = {
    "allow_bucket_quota_management": "bucket_quota_management",
    "allow_access_key_management": "ceph_s3_user_keys",
    "allow_access_key_metadata": "access_key_metadata",
    "allow_access_key_expiration": "access_key_expiration",
    "allow_managed_private_connection_provisioning": "managed_private_connection_provisioning",
}

MANAGER_ACTIVITY_RESOURCE_FIELDS = {
    "allow_activity_history": "activity_history",
}

MANAGER_ACCOUNT_POLICY_FIELDS = {
    "allow_rgw_usage_metrics": "rgw_usage_metrics",
}

PROJECT_RESOURCE_FIELDS = {
    "allow_bucket_usage_stats": "bucket_usage_stats",
}

PROJECT_COLLECTION_RESOURCE_FIELDS = {
    "allow_bucket_usage_stats_collection": "bucket_usage_stats",
}

MANAGER_OVERRIDE_FEATURES = {
    **MANAGER_RESOURCE_FIELDS,
    **MANAGER_ACTIVITY_RESOURCE_FIELDS,
    **MANAGER_ACCOUNT_POLICY_FIELDS,
}

RESOURCE_FEATURE_OVERRIDE_FIELDS = {
    **MANAGER_OVERRIDE_FEATURES,
    **PROJECT_RESOURCE_FIELDS,
    **PROJECT_COLLECTION_RESOURCE_FIELDS,
}

ManagerActivityResource = S3Account | S3User | S3Connection


def _override_values(
    payload: ApiModel,
    fields: dict[str, str],
) -> dict[str, bool | None]:
    return {
        field: getattr(payload, field)
        for field in fields
        if field in payload.model_fields_set
    }


def _validate_overrides(
    payload: ApiModel,
    policies: ManagerFeaturePolicies | ProjectFeaturePolicies | ProjectCollectionPolicies,
    fields: dict[str, str],
    current: S3Account | S3User | S3Connection | None,
    *,
    error_message: str,
) -> None:
    for field, value in _override_values(payload, fields).items():
        feature = fields[field]
        if (
            value is True
            and getattr(policies, feature) == FeaturePolicy.DISABLED
            and (current is None or getattr(current, field) is not True)
        ):
            raise ValueError(error_message)


def apply_resource_feature_overrides(
    payload: ApiModel,
    resource: S3Account | S3User | S3Connection,
) -> None:
    """Persist only feature overrides explicitly present in an update payload."""
    for field in RESOURCE_FEATURE_OVERRIDE_FIELDS:
        if field in payload.model_fields_set:
            setattr(resource, field, getattr(payload, field))


def validate_manager_overrides(
    payload: ApiModel,
    policies: ManagerFeaturePolicies,
    current: S3Account | S3User | S3Connection | None = None,
) -> None:
    _validate_overrides(
        payload,
        policies,
        MANAGER_OVERRIDE_FEATURES,
        current,
        error_message="This feature is disabled by the platform",
    )


def validate_project_overrides(
    payload: ApiModel,
    policies: ProjectFeaturePolicies,
    current: S3Account | None = None,
) -> None:
    _validate_overrides(
        payload,
        policies,
        PROJECT_RESOURCE_FIELDS,
        current,
        error_message="This feature is disabled by the platform",
    )


def validate_project_collection_overrides(
    payload: ApiModel,
    policies: ProjectCollectionPolicies,
    current: S3Account | None = None,
) -> None:
    _validate_overrides(
        payload,
        policies,
        PROJECT_COLLECTION_RESOURCE_FIELDS,
        current,
        error_message="This collection is disabled by the platform",
    )


def project_account_resource(db: Session, context: S3ExecutionContext) -> S3Account | None:
    if context.context_kind in {"account", "portal_account", "session"}:
        if isinstance(context.id, int):
            account = db.get(S3Account, context.id)
            if account is not None:
                return account
        if context.rgw_account_id:
            return db.scalars(
                select(S3Account).where(
                    S3Account.rgw_account_id == context.rgw_account_id
                )
            ).first()
    return None


def manager_rgw_usage_metrics_state(
    policies: ManagerFeaturePolicies,
    resource: S3Account | None,
) -> FeatureState:
    return resolve_feature_policy(
        policies.rgw_usage_metrics,
        resource.allow_rgw_usage_metrics if resource is not None else None,
    )


def bucket_usage_stats_state(
    policies: ProjectFeaturePolicies,
    resource: S3Account | None,
) -> FeatureState:
    return resolve_feature_policy(
        policies.bucket_usage_stats,
        resource.allow_bucket_usage_stats if resource is not None else None,
    )


def bucket_usage_stats_collection_state(
    policies: ProjectCollectionPolicies,
    resource: S3Account | None,
) -> FeatureState:
    return resolve_feature_policy(
        policies.bucket_usage_stats,
        resource.allow_bucket_usage_stats_collection if resource is not None else None,
    )


def manager_activity_resource(
    db: Session,
    context: S3ExecutionContext,
) -> ManagerActivityResource | None:
    """Resolve the durable resource that owns Manager activity policy/history."""
    if context.context_kind == "account" and isinstance(context.id, int):
        return db.get(S3Account, context.id)
    if context.context_kind == "s3_user" and context.s3_user_id is not None:
        return db.get(S3User, context.s3_user_id)
    if context.context_kind == "connection" and context.s3_connection_id is not None:
        connection = db.get(S3Connection, context.s3_connection_id)
        if connection is not None and connection.is_shared:
            return connection
    return None


def manager_activity_state(
    policies: ManagerFeaturePolicies,
    resource: ManagerActivityResource | None,
) -> FeatureState:
    if resource is None:
        return FeatureState(enabled=False, source="platform", blocked_reason="unsupported_context")
    return resolve_feature_policy(policies.activity_history, resource.allow_activity_history)


def manager_resource_states(policies: ManagerFeaturePolicies, resource: S3Account | S3User | None,
                            availability: dict[str, bool],
                            provisioning_source: Literal["platform", "direct", "group"] | None = None,
                            activity_resource: ManagerActivityResource | None = None) -> dict[str, FeatureState]:
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
    states["activity_history"] = manager_activity_state(
        policies,
        activity_resource if activity_resource is not None else resource,
    )
    return states
