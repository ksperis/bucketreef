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
    manager_update_audit_action: str
    delete_action: BucketConfigDeleteAction | None = None
    manager_delete_audit_action: str | None = None


_MUTATIONS: dict[BucketConfigArea, BucketConfigMutationDefinition] = {
    "versioning": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.update_bucket_versioning_config,
        manager_update_audit_action="update_bucket_versioning",
    ),
    "object_lock": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_object_lock_config,
        manager_update_audit_action="update_bucket_object_lock",
    ),
    "encryption": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_encryption_config,
        manager_update_audit_action="update_bucket_encryption",
        delete_action=bucket_config_actions.delete_bucket_encryption_config,
        manager_delete_audit_action="delete_bucket_encryption",
    ),
    "policy": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_policy_config,
        manager_update_audit_action="put_bucket_policy",
        delete_action=bucket_config_actions.delete_bucket_policy_config,
        manager_delete_audit_action="delete_bucket_policy",
    ),
    "acl": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_acl_config,
        manager_update_audit_action="update_bucket_acl",
    ),
    "public_access_block": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_public_access_block_config,
        manager_update_audit_action="update_public_access_block",
    ),
    "lifecycle": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_lifecycle_config,
        manager_update_audit_action="update_bucket_lifecycle",
        delete_action=bucket_config_actions.delete_bucket_lifecycle_config,
        manager_delete_audit_action="delete_bucket_lifecycle",
    ),
    "cors": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_cors_config,
        manager_update_audit_action="update_bucket_cors",
        delete_action=bucket_config_actions.delete_bucket_cors_config,
        manager_delete_audit_action="delete_bucket_cors",
    ),
    "notifications": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_notifications_config,
        manager_update_audit_action="update_bucket_notifications",
        delete_action=bucket_config_actions.delete_bucket_notifications_config,
        manager_delete_audit_action="delete_bucket_notifications",
    ),
    "replication": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_replication_config,
        manager_update_audit_action="update_bucket_replication",
        delete_action=bucket_config_actions.delete_bucket_replication_config,
        manager_delete_audit_action="delete_bucket_replication",
    ),
    "logging": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_logging_config,
        manager_update_audit_action="update_bucket_logging",
        delete_action=bucket_config_actions.delete_bucket_logging_config,
        manager_delete_audit_action="delete_bucket_logging",
    ),
    "website": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_website_config,
        manager_update_audit_action="update_bucket_website",
        delete_action=bucket_config_actions.delete_bucket_website_config,
        manager_delete_audit_action="delete_bucket_website",
    ),
    "tags": BucketConfigMutationDefinition(
        update_action=bucket_config_actions.put_bucket_tags_config,
        manager_update_audit_action="update_bucket_tags",
        delete_action=bucket_config_actions.delete_bucket_tags_config,
        manager_delete_audit_action="delete_bucket_tags",
    ),
}


def get_bucket_config_mutation(config_area: BucketConfigArea) -> BucketConfigMutationDefinition:
    return _MUTATIONS[config_area]


def get_bucket_config_delete_mutation(config_area: BucketConfigArea) -> BucketConfigMutationDefinition:
    mutation = get_bucket_config_mutation(config_area)
    if mutation.delete_action is None or mutation.manager_delete_audit_action is None:
        raise ValueError(f"Bucket config area does not support delete: {config_area}")
    return mutation
