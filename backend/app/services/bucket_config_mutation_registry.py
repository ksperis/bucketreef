# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal

from app.services import bucket_config_actions

BucketConfigArea = Literal[
    "versioning",
    "object_lock",
    "encryption",
    "policy",
    "acl",
    "public_access_block",
    "lifecycle",
    "cors",
    "notifications",
    "replication",
    "logging",
    "website",
    "tags",
]
BucketConfigUpdateAction = Callable[..., tuple[Any, dict[str, Any]]]
BucketConfigDeleteAction = Callable[..., None]


@dataclass(frozen=True)
class BucketConfigMutationDefinition:
    update_action: BucketConfigUpdateAction
    delete_action: BucketConfigDeleteAction | None = None


_MANAGER_UPDATE_AUDIT_OVERRIDES: dict[BucketConfigArea, str] = {
    "policy": "put_bucket_policy",
    "public_access_block": "update_public_access_block",
}


def manager_bucket_config_audit_action(
    config_area: BucketConfigArea,
    *,
    operation: Literal["update", "delete"],
) -> str:
    if operation == "delete":
        return f"delete_bucket_{config_area}"
    return _MANAGER_UPDATE_AUDIT_OVERRIDES.get(config_area, f"update_bucket_{config_area}")


_MUTATIONS: dict[BucketConfigArea, BucketConfigMutationDefinition] = {
    "versioning": BucketConfigMutationDefinition(
        bucket_config_actions.update_bucket_versioning_config,
    ),
    "object_lock": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_object_lock_config,
    ),
    "encryption": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_encryption_config,
        delete_action=bucket_config_actions.delete_bucket_encryption_config,
    ),
    "policy": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_policy_config,
        delete_action=bucket_config_actions.delete_bucket_policy_config,
    ),
    "acl": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_acl_config,
    ),
    "public_access_block": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_public_access_block_config,
    ),
    "lifecycle": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_lifecycle_config,
        delete_action=bucket_config_actions.delete_bucket_lifecycle_config,
    ),
    "cors": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_cors_config,
        delete_action=bucket_config_actions.delete_bucket_cors_config,
    ),
    "notifications": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_notifications_config,
        delete_action=bucket_config_actions.delete_bucket_notifications_config,
    ),
    "replication": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_replication_config,
        delete_action=bucket_config_actions.delete_bucket_replication_config,
    ),
    "logging": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_logging_config,
        delete_action=bucket_config_actions.delete_bucket_logging_config,
    ),
    "website": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_website_config,
        delete_action=bucket_config_actions.delete_bucket_website_config,
    ),
    "tags": BucketConfigMutationDefinition(
        bucket_config_actions.put_bucket_tags_config,
        delete_action=bucket_config_actions.delete_bucket_tags_config,
    ),
}


def get_bucket_config_mutation(config_area: BucketConfigArea) -> BucketConfigMutationDefinition:
    return _MUTATIONS[config_area]


def get_bucket_config_delete_mutation(config_area: BucketConfigArea) -> BucketConfigMutationDefinition:
    mutation = get_bucket_config_mutation(config_area)
    if mutation.delete_action is None:
        raise ValueError(f"Bucket config area does not support delete: {config_area}")
    return mutation
