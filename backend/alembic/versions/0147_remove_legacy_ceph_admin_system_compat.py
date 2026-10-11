# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Remove legacy Ceph Admin system-user compatibility."""

import sqlalchemy as sa
from alembic import op


revision = "0147_remove_legacy_ceph_admin_system_compat"
down_revision = "0146_manager_access_key_expiration"
branch_labels = None
depends_on = None


def upgrade():
    identities = sa.table(
        "endpoint_service_identities",
        sa.column("kind"),
        sa.column("status"),
        sa.column("last_error"),
        sa.column("last_reconciled_at"),
        sa.column("legacy_system_compat"),
    )
    connection = op.get_bind()
    connection.execute(
        identities.update()
        .where(
            identities.c.kind == "ceph_admin",
            identities.c.legacy_system_compat.is_(True),
        )
        .values(status="missing", last_error=None, last_reconciled_at=None)
    )
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_column("legacy_system_compat")


def downgrade():
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.add_column(
            sa.Column(
                "legacy_system_compat",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    identities = sa.table(
        "endpoint_service_identities",
        sa.column("kind"),
        sa.column("access_key"),
        sa.column("secret_key"),
        sa.column("legacy_system_compat"),
    )
    connection = op.get_bind()
    connection.execute(
        identities.update()
        .where(
            identities.c.kind == "ceph_admin",
            identities.c.access_key.is_not(None),
            identities.c.secret_key.is_not(None),
        )
        .values(legacy_system_compat=True)
    )
