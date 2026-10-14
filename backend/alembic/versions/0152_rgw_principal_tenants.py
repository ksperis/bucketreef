"""Persist RGW tenant identity independently from RGW account IDs.

Legacy identities are left NULL, as their tenant cannot be safely inferred
from a bare UID or an RGW account identifier.
"""

import sqlalchemy as sa
from alembic import op

revision = "0152_rgw_principal_tenants"
down_revision = "0151_project_usage_feature_overrides"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("rgw_tenant", sa.String(), nullable=True))
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("rgw_tenant", sa.String(), nullable=True))
        batch.drop_constraint("uq_s3_users_uid", type_="unique")
        batch.create_unique_constraint(
            "uq_s3_users_endpoint_tenant_uid",
            ["storage_endpoint_id", "rgw_tenant", "rgw_user_uid"],
        )
    op.create_index(
        "uq_s3_users_endpoint_effective_tenant_uid",
        "s3_users",
        ["storage_endpoint_id", sa.text("coalesce(rgw_tenant, '')"), "rgw_user_uid"],
        unique=True,
    )


def downgrade():
    bind = op.get_bind()
    duplicated = bind.execute(sa.text(
        "SELECT rgw_user_uid FROM s3_users GROUP BY rgw_user_uid HAVING COUNT(*) > 1 LIMIT 1"
    )).first()
    if duplicated:
        raise RuntimeError("Cannot downgrade: RGW user UIDs would become non-unique")
    op.drop_index("uq_s3_users_endpoint_effective_tenant_uid", table_name="s3_users")
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_constraint("uq_s3_users_endpoint_tenant_uid", type_="unique")
        batch.create_unique_constraint("uq_s3_users_uid", ["rgw_user_uid"])
        batch.drop_column("rgw_tenant")
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("rgw_tenant")
