# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persist Keystone catalog targets for OpenStack project contexts."""
from alembic import op
import sqlalchemy as sa

revision = "0195_openstack_catalog_targets"
down_revision = "0194_openstack_connect"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("openstack_clouds") as batch:
        batch.add_column(sa.Column("managed_endpoints_only", sa.Boolean(), nullable=False, server_default="0"))

    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.add_column(sa.Column("target_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("region_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("endpoint_url", sa.String(), nullable=True))
        batch.add_column(sa.Column("endpoint_name", sa.String(), nullable=True))
        batch.add_column(sa.Column("endpoint_interface", sa.String(), nullable=True))
        batch.add_column(sa.Column("service_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("service_name", sa.String(), nullable=True))

    connection = op.get_bind()
    connection.execute(sa.text("""
        UPDATE openstack_project_contexts
        SET target_id = 'legacy-storage-endpoint:' || endpoint_id,
            region_id = COALESCE(
                (SELECT region FROM storage_endpoints WHERE storage_endpoints.id = openstack_project_contexts.endpoint_id),
                (SELECT name FROM storage_endpoints WHERE storage_endpoints.id = openstack_project_contexts.endpoint_id),
                'legacy'
            ),
            endpoint_url = COALESCE(
                (SELECT endpoint_url FROM storage_endpoints WHERE storage_endpoints.id = openstack_project_contexts.endpoint_id),
                ''
            ),
            endpoint_name = COALESCE(
                (SELECT name FROM storage_endpoints WHERE storage_endpoints.id = openstack_project_contexts.endpoint_id),
                'Legacy S3 endpoint'
            ),
            endpoint_interface = 'legacy',
            service_type = 's3',
            service_name = (SELECT name FROM storage_endpoints WHERE storage_endpoints.id = openstack_project_contexts.endpoint_id)
    """))

    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.drop_constraint("uq_openstack_project_endpoint", type_="unique")
        batch.alter_column("endpoint_id", existing_type=sa.Integer(), nullable=True)
        for name in ("target_id", "region_id", "endpoint_url", "endpoint_name", "endpoint_interface", "service_type"):
            batch.alter_column(name, existing_type=sa.String(), nullable=False)
        batch.create_unique_constraint(
            "uq_openstack_project_target",
            ["connection_id", "project_id", "target_id"],
        )

    # The Keystone catalog is now the only source of truth for OpenStack S3
    # targets. The legacy cloud-to-StorageEndpoint association is no longer
    # part of the runtime model after existing contexts have been backfilled.
    op.drop_table("openstack_cloud_endpoints")


def downgrade():
    op.create_table(
        "openstack_cloud_endpoints",
        sa.Column("cloud_id", sa.Integer(), sa.ForeignKey("openstack_clouds.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id", ondelete="CASCADE"), primary_key=True),
    )
    bind = op.get_bind()
    # Catalog-native contexts cannot be represented by the 0194 schema, where
    # every context must reference a managed storage endpoint. They are
    # session-derived and can be recreated after reconnecting if 0195 is
    # applied again, so remove them before restoring the NOT NULL constraint.
    bind.execute(sa.text("""
        DELETE FROM openstack_project_credentials
        WHERE context_id IN (
            SELECT id FROM openstack_project_contexts WHERE endpoint_id IS NULL
        )
    """))
    bind.execute(sa.text("DELETE FROM openstack_project_contexts WHERE endpoint_id IS NULL"))
    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.drop_constraint("uq_openstack_project_target", type_="unique")
        batch.alter_column("endpoint_id", existing_type=sa.Integer(), nullable=False)
        for name in (
            "service_name", "service_type", "endpoint_interface", "endpoint_name",
            "endpoint_url", "region_id", "target_id",
        ):
            batch.drop_column(name)
        batch.create_unique_constraint(
            "uq_openstack_project_endpoint",
            ["connection_id", "project_id", "endpoint_id"],
        )
    with op.batch_alter_table("openstack_clouds") as batch:
        batch.drop_column("managed_endpoints_only")
