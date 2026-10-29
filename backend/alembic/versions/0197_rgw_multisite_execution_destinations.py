# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Add declarative RGW multisite execution destinations."""

from alembic import op
import sqlalchemy as sa


revision = "0197_rgw_multisite_execution_destinations"
down_revision = "0196_openstack_all_users_group"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.add_column(sa.Column("realm_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("zonegroup_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("zone_id", sa.String(), nullable=True))

    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column(
                "allow_multisite_endpoint_switching",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    with op.batch_alter_table("ui_groups") as batch:
        batch.add_column(
            sa.Column(
                "allow_multisite_endpoint_switching",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("ui_groups") as batch:
        batch.drop_column("allow_multisite_endpoint_switching")

    with op.batch_alter_table("users") as batch:
        batch.drop_column("allow_multisite_endpoint_switching")

    with op.batch_alter_table("storage_endpoints") as batch:
        batch.drop_column("zone_id")
        batch.drop_column("zonegroup_id")
        batch.drop_column("realm_id")
