# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Make the Runtime service identity the service-mode source of truth."""

import sqlalchemy as sa
from alembic import op

from app.utils.time import utcnow


revision = "0140_runtime_identity_mode_source"
down_revision = "0139_managed_ceph_admin_identity"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    metadata = sa.MetaData()
    endpoints = sa.Table("storage_endpoints", metadata, autoload_with=connection)
    identities = sa.Table("endpoint_service_identities", metadata, autoload_with=connection)
    now = utcnow()

    for endpoint in connection.execute(
        sa.select(
            endpoints.c.id,
            endpoints.c.provider,
            endpoints.c.service_identity_mode,
        )
    ).mappings():
        if endpoint["provider"] != "ceph":
            continue
        has_runtime = connection.scalar(
            sa.select(sa.func.count())
            .select_from(identities)
            .where(
                identities.c.endpoint_id == endpoint["id"],
                identities.c.kind == "runtime",
            )
        )
        if not has_runtime:
            connection.execute(
                identities.insert().values(
                    endpoint_id=endpoint["id"],
                    kind="runtime",
                    mode=endpoint["service_identity_mode"] or "managed",
                    status="missing",
                    created_at=now,
                    updated_at=now,
                )
            )

    with op.batch_alter_table("storage_endpoints") as batch:
        batch.drop_column("service_identity_mode")


def downgrade():
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.add_column(
            sa.Column(
                "service_identity_mode",
                sa.String(16),
                nullable=False,
                server_default="managed",
            )
        )

    connection = op.get_bind()
    metadata = sa.MetaData()
    endpoints = sa.Table("storage_endpoints", metadata, autoload_with=connection)
    identities = sa.Table("endpoint_service_identities", metadata, autoload_with=connection)
    runtime_modes = connection.execute(
        sa.select(identities.c.endpoint_id, identities.c.mode).where(
            identities.c.kind == "runtime"
        )
    ).all()
    for endpoint_id, mode in runtime_modes:
        connection.execute(
            endpoints.update()
            .where(endpoints.c.id == endpoint_id)
            .values(service_identity_mode=mode)
        )
