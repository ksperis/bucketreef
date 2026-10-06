# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import uuid


MANAGED_STORAGE_PREFIX = "bkr"
MANAGED_IAM_USERNAME_MAX_LENGTH = 63

PORTAL_MANAGER_GROUP_NAME = f"{MANAGED_STORAGE_PREFIX}-portal-manager"
PORTAL_USER_GROUP_NAME = f"{MANAGED_STORAGE_PREFIX}-portal-user"
PORTAL_MANAGED_IAM_GROUP_NAMES = frozenset(
    {PORTAL_MANAGER_GROUP_NAME, PORTAL_USER_GROUP_NAME}
)

PORTAL_MANAGER_GROUP_POLICY_NAME = f"{MANAGED_STORAGE_PREFIX}-portal-manager"
PORTAL_USER_GROUP_POLICY_NAME = f"{MANAGED_STORAGE_PREFIX}-portal-self-service"
PORTAL_USER_BUCKET_POLICY_NAME = f"{MANAGED_STORAGE_PREFIX}-portal-user-buckets"
PORTAL_EXTERNAL_ACCESS_POLICY_NAME = f"{MANAGED_STORAGE_PREFIX}-portal-external-storage-space"

PORTAL_MANAGER_BOOTSTRAP_SID = "BucketReefPortalManagerBootstrap"
PORTAL_MANAGER_PROJECT_STORAGE_SID = "BucketReefPortalManagerProjectStorage"
PORTAL_USER_BOOTSTRAP_SID = "BucketReefPortalUserBootstrap"
PORTAL_EXTERNAL_STORAGE_SPACE_SID = "BucketReefPortalExternalStorageSpace"
PORTAL_USER_BUCKETS_SID = "BucketReefPortalUserBuckets"
PORTAL_STORAGE_SPACE_SHARE_SID_PREFIX = "BucketReefPortalStorageSpace"
PORTAL_STORAGE_SPACE_ACCESS_SID = "BucketReefPortalStorageSpaceAccess"
PORTAL_STORAGE_SPACE_PRIVATE_SID = "BucketReefPortalStorageSpacePrivate"
PORTAL_STORAGE_SPACE_ARCHIVED_SID = "BucketReefPortalStorageSpaceArchived"

PORTAL_EXPIRE_DELETE_MARKERS_RULE_ID = "BucketReefPortalExpireDeleteMarkers"
PORTAL_EXPIRE_OLD_VERSIONS_RULE_ID = "BucketReefPortalExpireOldVersions"
PORTAL_LIFECYCLE_RULE_IDS = frozenset(
    {PORTAL_EXPIRE_DELETE_MARKERS_RULE_ID, PORTAL_EXPIRE_OLD_VERSIONS_RULE_ID}
)

PORTAL_SERVER_ACCESS_LOGGING_SID = "BucketReefPortalServerAccessLogging"
PORTAL_SERVER_ACCESS_LOGGING_MANAGER_DENY_SID = "BucketReefPortalManagerDeny"
PORTAL_SERVER_ACCESS_LOGGING_RETENTION_RULE_ID = "BucketReefPortalExpireServerAccessLogs"

ACCOUNT_ROOT_KEY_NAME = f"{MANAGED_STORAGE_PREFIX}-account-root"

MIGRATION_PROBE_OBJECT_KEY = f"__{MANAGED_STORAGE_PREFIX}__/migration/check"
MIGRATION_LOCK_PROBE_OBJECT_PREFIX = f"__{MANAGED_STORAGE_PREFIX}__/migration/lock-check"


def portal_iam_username(account_id: int, user_id: int) -> str:
    return f"{MANAGED_STORAGE_PREFIX}-portal-{account_id}-{user_id}"[:MANAGED_IAM_USERNAME_MAX_LENGTH]


def portal_external_iam_username(
    account_id: int,
    storage_space_id: int,
    slug: str,
    token: str,
) -> str:
    stem = f"{MANAGED_STORAGE_PREFIX}-portal-ext-{account_id}-{storage_space_id}"
    suffix = f"-{token}"
    slug_budget = MANAGED_IAM_USERNAME_MAX_LENGTH - len(stem) - len(suffix) - 1

    if slug_budget > 0:
        truncated_slug = slug[:slug_budget].rstrip("-")
        if truncated_slug:
            return f"{stem}-{truncated_slug}{suffix}"

    username = f"{stem}{suffix}"
    if len(username) > MANAGED_IAM_USERNAME_MAX_LENGTH:
        raise ValueError("Portal external IAM username identifiers exceed the supported length.")
    return username


def portal_storage_space_bucket_name() -> str:
    return f"{MANAGED_STORAGE_PREFIX}-space-{uuid.uuid4()}"


def managed_s3_user_uid() -> str:
    return f"{MANAGED_STORAGE_PREFIX}-s3u-{uuid.uuid4().hex}"


def portal_access_log_bucket_name(
    account_id: int,
    rgw_account_id: str,
    account_name: str,
) -> str:
    seed = f"{rgw_account_id}{account_name}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8]
    return f"{MANAGED_STORAGE_PREFIX}-portal-access-logs-{account_id}-{digest}"


def managed_private_iam_username(user_id: int, source_kind: str, source_id: int) -> str:
    kind = "acc" if source_kind == "account" else "conn"
    return f"{MANAGED_STORAGE_PREFIX}-private-u{user_id}-{kind}{source_id}"


def migration_probe_bucket_name(migration_id: int) -> str:
    return f"{MANAGED_STORAGE_PREFIX}-mig-precheck-{migration_id}-{uuid.uuid4().hex[:12]}"


def migration_lock_probe_object_key() -> str:
    return f"{MIGRATION_LOCK_PROBE_OBJECT_PREFIX}/{uuid.uuid4().hex}"


def onboarding_sample_account_name(rgw_account_id: str) -> str:
    return f"{MANAGED_STORAGE_PREFIX}-sample-{rgw_account_id[-8:]}"
