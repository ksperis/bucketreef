# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Preserve the pre-0.2.14 Ceph Admin system-user acceptance contract."""

import sqlalchemy as sa
from alembic import op


revision = "0144_legacy_ceph_admin_system_compat"
down_revision = "0143_external_ceph_admin_credentials"
branch_labels = None
depends_on = None


def upgrade():
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


def downgrade():
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_column("legacy_system_compat")
