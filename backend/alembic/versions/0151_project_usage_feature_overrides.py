# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Add project overrides for usage metrics and bucket composition statistics."""

import json

import sqlalchemy as sa
from alembic import op

revision = "0151_project_usage_feature_overrides"
down_revision = "0150_audit_execution_context"
branch_labels = None
depends_on = None


def _upgrade_settings(payload: dict) -> dict:
    general = payload.setdefault("general", {})
    project_policies = general.setdefault("project_feature_policies", {})
    if "bucket_usage_stats_enabled" in general:
        value = general.pop("bucket_usage_stats_enabled")
        if isinstance(value, bool):
            project_policies.setdefault("bucket_usage_stats", "default_on" if value else "disabled")

    manager = payload.setdefault("manager", {})
    manager_policies = manager.setdefault("feature_policies", {})
    if "manager_rgw_usage_metrics_enabled" in manager:
        value = manager.pop("manager_rgw_usage_metrics_enabled")
        if isinstance(value, bool):
            manager_policies.setdefault("rgw_usage_metrics", "default_on" if value else "disabled")
    return payload


def _downgrade_settings(payload: dict) -> dict:
    general = payload.setdefault("general", {})
    project_policies = general.get("project_feature_policies") or {}
    if "bucket_usage_stats" in project_policies:
        general["bucket_usage_stats_enabled"] = project_policies.pop("bucket_usage_stats") == "default_on"
    if not project_policies:
        general.pop("project_feature_policies", None)

    manager = payload.setdefault("manager", {})
    manager_policies = manager.get("feature_policies") or {}
    if "rgw_usage_metrics" in manager_policies:
        manager["manager_rgw_usage_metrics_enabled"] = manager_policies.pop("rgw_usage_metrics") == "default_on"
    return payload


def _rewrite_settings(transform) -> None:
    bind = op.get_bind()
    settings = sa.table(
        "app_settings",
        sa.column("key", sa.String()),
        sa.column("payload_json", sa.Text()),
    )
    rows = bind.execute(
        sa.select(settings.c.key, settings.c.payload_json).where(settings.c.key == "default")
    ).mappings()
    for row in rows:
        payload = transform(json.loads(row["payload_json"]))
        bind.execute(
            settings.update()
            .where(settings.c.key == row["key"])
            .values(payload_json=json.dumps(payload))
        )


def upgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("allow_rgw_usage_metrics", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("allow_bucket_usage_stats", sa.Boolean(), nullable=True))
    _rewrite_settings(_upgrade_settings)


def downgrade():
    _rewrite_settings(_downgrade_settings)
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("allow_bucket_usage_stats")
        batch.drop_column("allow_rgw_usage_metrics")
