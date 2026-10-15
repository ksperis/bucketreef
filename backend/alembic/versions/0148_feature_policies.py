# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Canonical feature policies and nullable resource overrides; preserve explicit choices."""
import json

import sqlalchemy as sa
from alembic import op

from app.models.feature_policy import PORTAL_FEATURE_FIELDS
from app.utils.app_settings_import import LEGACY_MANAGER_FEATURE_FIELDS, normalize_settings_import

revision = "0148_feature_policies"
down_revision = "0147_remove_legacy_ceph_admin_system_compat"
branch_labels = None
depends_on = None

RESOURCE_FIELDS = {
    "s3_accounts": ("allow_bucket_quota_management", "allow_access_key_metadata", "allow_access_key_expiration"),
    "s3_users": ("allow_bucket_quota_management", "allow_access_key_management", "allow_access_key_metadata", "allow_access_key_expiration", "allow_managed_private_connection_provisioning"),
}


def upgrade():
    bind = op.get_bind()
    settings = sa.table("app_settings", sa.column("key", sa.String()), sa.column("payload_json", sa.Text()))
    for row in bind.execute(sa.select(settings.c.key, settings.c.payload_json).where(settings.c.key == "default")).mappings():
        payload = normalize_settings_import(json.loads(row["payload_json"]))
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
        for field, feature in LEGACY_MANAGER_FEATURE_FIELDS.items():
            if feature in manager:
                payload.setdefault("general", {})[field] = manager[feature] != "disabled"
        portal = payload.setdefault("portal", {})
        policies = portal.pop("feature_policies", {})
        for field, feature in PORTAL_FEATURE_FIELDS.items():
            if feature in policies:
                portal[field] = policies[feature] == "default_on"
        bind.execute(settings.update().where(settings.c.key == row["key"]).values(payload_json=json.dumps(payload)))
