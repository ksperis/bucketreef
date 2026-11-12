"""Persist deployment configuration ownership and endpoint keys."""

import sqlalchemy as sa
from alembic import op

revision = "0271_deployment_configuration"
down_revision = "0270_retained_user_history_foreign_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.add_column(sa.Column("deployment_key", sa.String(64), nullable=True))
        batch.create_unique_constraint("uq_storage_endpoints_deployment_key", ["deployment_key"])
    configuration = op.create_table(
        "deployment_configuration",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("manifest_digest", sa.String(64)),
        sa.Column("storage_endpoints_managed", sa.Boolean(), nullable=False),
        sa.Column("locked_features", sa.JSON(), nullable=False),
    )
    endpoints = sa.table(
        "storage_endpoints",
        sa.column("id", sa.Integer()),
        sa.column("is_editable", sa.Boolean()),
        sa.column("deployment_key", sa.String()),
    )
    connection = op.get_bind()
    adopted = connection.execute(
        endpoints.update()
        .where(endpoints.c.is_editable.is_(False))
        .values(deployment_key=sa.literal("endpoint-") + sa.cast(endpoints.c.id, sa.String()))
    ).rowcount
    op.bulk_insert(configuration, [{
        "key": "installation",
        "revision": 0,
        "manifest_digest": None,
        "storage_endpoints_managed": bool(adopted),
        "locked_features": [],
    }])


def downgrade() -> None:
    op.drop_table("deployment_configuration")
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.drop_constraint("uq_storage_endpoints_deployment_key", type_="unique")
        batch.drop_column("deployment_key")
