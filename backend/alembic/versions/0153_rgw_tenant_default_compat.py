"""Repair RGW tenant defaults for databases that ran the original 0152.

Revision 0152 was amended before release so pre-tenant BucketReef identities
are persisted in the default RGW tenant. Development databases may already
have executed the earlier nullable version, so normalize those rows and schema
without keeping a runtime compatibility path.
"""

import sqlalchemy as sa
from alembic import op


revision = "0153_rgw_tenant_default_compat"
down_revision = "0152_rgw_principal_tenants"
branch_labels = None
depends_on = None


_OBSOLETE_INDEX = "uq_s3_users_endpoint_effective_tenant_uid"


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if bind.dialect.name == "sqlite":
        return bind.execute(
            sa.text(
                "SELECT 1 FROM sqlite_master "
                "WHERE type = 'index' AND tbl_name = :table_name AND name = :index_name"
            ),
            {"table_name": table_name, "index_name": index_name},
        ).first() is not None
    return any(index.get("name") == index_name for index in sa.inspect(bind).get_indexes(table_name))


def _repair_tenant_column(bind, table_name: str) -> None:
    bind.execute(sa.text(f"UPDATE {table_name} SET rgw_tenant = '' WHERE rgw_tenant IS NULL"))
    column = next(
        item for item in sa.inspect(bind).get_columns(table_name) if item["name"] == "rgw_tenant"
    )
    if column["nullable"] or column.get("default") is None:
        with op.batch_alter_table(table_name) as batch:
            batch.alter_column(
                "rgw_tenant",
                existing_type=sa.String(),
                nullable=False,
                server_default="",
            )


def upgrade():
    bind = op.get_bind()
    if _index_exists(bind, "s3_users", _OBSOLETE_INDEX):
        op.drop_index(_OBSOLETE_INDEX, table_name="s3_users")
    _repair_tenant_column(bind, "s3_accounts")
    _repair_tenant_column(bind, "s3_users")


def downgrade():
    # Current 0152 already defines the repaired non-null/default schema.
    pass
