# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add optional multisite association to storage endpoints.

Revision ID: 0194_storage_endpoint_multisite_association
Revises: 0193_remove_unused_quota_alert_state
Create Date: 2026-10-27 12:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0194_storage_endpoint_multisite_association"
down_revision = "0193_remove_unused_quota_alert_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.add_column(sa.Column("multisite_realm_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("multisite_zonegroup_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("multisite_zone_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("multisite_diagnostic", sa.Boolean(), server_default="0", nullable=False))
        batch.create_check_constraint(
            "ck_storage_endpoints_multisite_association_complete",
            "((multisite_realm_id IS NULL AND multisite_zonegroup_id IS NULL AND multisite_zone_id IS NULL) "
            "OR (multisite_realm_id IS NOT NULL AND multisite_zonegroup_id IS NOT NULL AND multisite_zone_id IS NOT NULL))",
        )
        batch.create_check_constraint(
            "ck_storage_endpoints_multisite_diagnostic_requires_zone",
            "NOT multisite_diagnostic OR multisite_zone_id IS NOT NULL",
        )
        batch.create_check_constraint(
            "ck_storage_endpoints_multisite_ceph_only",
            "multisite_realm_id IS NULL OR provider = 'ceph'",
        )
    op.create_index(
        "uq_storage_endpoints_multisite_diagnostic_zone",
        "storage_endpoints",
        ["multisite_realm_id", "multisite_zonegroup_id", "multisite_zone_id"],
        unique=True,
        postgresql_where=sa.text("multisite_diagnostic = true"),
        sqlite_where=sa.text("multisite_diagnostic = 1"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_storage_endpoints_multisite_diagnostic_zone",
        table_name="storage_endpoints",
    )
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.drop_constraint("ck_storage_endpoints_multisite_ceph_only", type_="check")
        batch.drop_constraint("ck_storage_endpoints_multisite_diagnostic_requires_zone", type_="check")
        batch.drop_constraint("ck_storage_endpoints_multisite_association_complete", type_="check")
        batch.drop_column("multisite_diagnostic")
        batch.drop_column("multisite_zone_id")
        batch.drop_column("multisite_zonegroup_id")
        batch.drop_column("multisite_realm_id")
