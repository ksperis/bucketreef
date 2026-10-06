# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Make Ceph Admin identities managed without discarding existing credentials."""

import sqlalchemy as sa
from alembic import op


revision = "0139_managed_ceph_admin_identity"
down_revision = "0138_endpoint_service_identities"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    identities = sa.Table(
        "endpoint_service_identities",
        sa.MetaData(),
        autoload_with=connection,
    )
    connection.execute(
        identities.update()
        .where(
            identities.c.kind == "ceph_admin",
            identities.c.mode == "external",
        )
        .values(
            mode="managed",
            rgw_uid=None,
            previous_access_key=None,
            provenance=None,
            status="missing",
            last_error=None,
            last_reconciled_at=None,
        )
    )
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.create_check_constraint(
            "ck_endpoint_service_identity_ceph_admin_managed",
            "kind != 'ceph_admin' OR mode = 'managed'",
        )


def downgrade():
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_constraint(
            "ck_endpoint_service_identity_ceph_admin_managed",
            type_="check",
        )
