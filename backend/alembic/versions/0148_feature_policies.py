# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Canonical feature policies and nullable resource overrides; preserve explicit choices."""
import json

import sqlalchemy as sa
from alembic import op

revision = "0148_feature_policies"
down_revision = "0147_remove_legacy_ceph_admin_system_compat"
branch_labels = None
depends_on = None

_LEGACY_MANAGER_FEATURE_FIELDS = {
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

_PORTAL_FEATURE_FIELDS = {
    "browser_access_enabled": "browser_access",
    "allow_private_storage_space_create": "private_storage_space_create",
    "allow_portal_named_bucket_create": "named_bucket_create",
    "allow_portal_user_access_key_create": "user_access_key_create",
    "allow_portal_user_external_sharing": "user_external_sharing",
    "server_access_logging_enabled": "server_access_logging",
    "storage_space_version_cleanup_enabled": "storage_space_version_cleanup",
}

RESOURCE_FIELDS = {
    "s3_accounts": ("allow_bucket_quota_management", "allow_access_key_metadata", "allow_access_key_expiration"),
    "s3_users": ("allow_bucket_quota_management", "allow_access_key_management", "allow_access_key_metadata", "allow_access_key_expiration", "allow_managed_private_connection_provisioning"),
}


def _normalize_settings_payload(payload: dict) -> dict:
    general = payload.setdefault("general", {})
    manager = payload.setdefault("manager", {})
    policies = manager.setdefault("feature_policies", {})
    for field, feature in _LEGACY_MANAGER_FEATURE_FIELDS.items():
        if field in general:
            value = general.pop(field)
            if not isinstance(value, bool):
                raise ValueError(f"Legacy setting {field} must be a boolean")
            policies.setdefault(feature, "targeted" if value else "disabled")
    portal = payload.setdefault("portal", {})
    portal_policies = portal.setdefault("feature_policies", {})
    for field, feature in _PORTAL_FEATURE_FIELDS.items():
        if field in portal:
            value = portal.pop(field)
            if not isinstance(value, bool):
                raise ValueError(f"Legacy setting {field} must be a boolean")
            portal_policies.setdefault(feature, "default_on" if value else "targeted")
    return payload


def upgrade():
    bind = op.get_bind()
    settings = sa.table("app_settings", sa.column("key", sa.String()), sa.column("payload_json", sa.Text()))
    for row in bind.execute(sa.select(settings.c.key, settings.c.payload_json).where(settings.c.key == "default")).mappings():
        payload = _normalize_settings_payload(json.loads(row["payload_json"]))
        bind.execute(settings.update().where(settings.c.key == row["key"]).values(payload_json=json.dumps(payload)))
    for table, fields in RESOURCE_FIELDS.items():
        with op.batch_alter_table(table) as batch:
            for field in fields:
                batch.alter_column(field, existing_type=sa.Boolean(), nullable=True, server_default=None)


def downgrade():
    bind = op.get_bind()
    # Older releases cannot express inheritance: retain a conservative opt-out.
    for table, fields in RESOURCE_FIELDS.items():
        columns = sa.table(table, *(sa.column(field, sa.Boolean()) for field in fields))
        for field in fields:
            bind.execute(columns.update().where(columns.c[field].is_(None)).values({field: False}))
        with op.batch_alter_table(table) as batch:
            for field in fields:
                batch.alter_column(field, existing_type=sa.Boolean(), nullable=False, server_default=sa.false())
    settings = sa.table("app_settings", sa.column("key", sa.String()), sa.column("payload_json", sa.Text()))
    for row in bind.execute(sa.select(settings.c.key, settings.c.payload_json).where(settings.c.key == "default")).mappings():
        payload = json.loads(row["payload_json"])
        manager = payload.get("manager", {}).pop("feature_policies", {})
        for field, feature in _LEGACY_MANAGER_FEATURE_FIELDS.items():
            if feature in manager:
                payload.setdefault("general", {})[field] = manager[feature] != "disabled"
        portal = payload.setdefault("portal", {})
        policies = portal.pop("feature_policies", {})
        for field, feature in _PORTAL_FEATURE_FIELDS.items():
            if feature in policies:
                portal[field] = policies[feature] == "default_on"
        bind.execute(settings.update().where(settings.c.key == row["key"]).values(payload_json=json.dumps(payload)))
