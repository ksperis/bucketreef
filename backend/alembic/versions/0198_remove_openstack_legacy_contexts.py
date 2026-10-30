# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Remove OpenStack contexts retained only for pre-catalog compatibility."""

from alembic import op
import sqlalchemy as sa


revision = "0198_remove_openstack_legacy_contexts"
down_revision = "0197_rgw_multisite_execution_destinations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            DELETE FROM openstack_project_credentials
            WHERE context_id IN (
                SELECT id
                FROM openstack_project_contexts
                WHERE endpoint_id IS NOT NULL
                   OR target_id LIKE 'legacy-storage-endpoint:%'
                   OR endpoint_interface = 'legacy'
            )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            DELETE FROM openstack_project_contexts
            WHERE endpoint_id IS NOT NULL
               OR target_id LIKE 'legacy-storage-endpoint:%'
               OR endpoint_interface = 'legacy'
            """
        )
    )

    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.drop_column("endpoint_id")


def downgrade() -> None:
    # Purged session-derived contexts cannot be reconstructed. Restoring the
    # nullable column is sufficient for the 0197 schema contract.
    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.add_column(sa.Column("endpoint_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_openstack_project_contexts_endpoint_id_storage_endpoints",
            "storage_endpoints",
            ["endpoint_id"],
            ["id"],
            ondelete="CASCADE",
        )
