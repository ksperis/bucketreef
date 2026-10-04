# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persist service identity provenance and move existing keys without decrypting them."""
import uuid

import sqlalchemy as sa
from alembic import op
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

revision = "0138_endpoint_service_identities"
down_revision = "0137_browser_path_favorites"
branch_labels = None
depends_on = None


def upgrade():
    identities = op.create_table(
        "endpoint_service_identities",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("rgw_uid", sa.String(128)),
        sa.Column("access_key", sa.String()),
        sa.Column("secret_key", sa.String()),
        sa.Column("previous_access_key", sa.String()),
        sa.Column("provenance", sa.String(128)),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("last_error", sa.String(256)),
        sa.Column("last_reconciled_at", UTCDateTime()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("endpoint_id", "kind", name="uq_endpoint_service_identity_kind"),
        sa.CheckConstraint("kind IN ('runtime', 'supervision', 'ceph_admin')", name="ck_endpoint_service_identity_kind"),
        sa.CheckConstraint("mode IN ('managed', 'external')", name="ck_endpoint_service_identity_mode"),
        sa.CheckConstraint("status IN ('missing', 'provisioning', 'ready', 'error', 'revocation_pending', 'disabled')", name="ck_endpoint_service_identity_status"),
    )
    op.create_index("ix_endpoint_service_identities_endpoint_id", "endpoint_service_identities", ["endpoint_id"])
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.add_column(sa.Column("identity_namespace", sa.String(32), nullable=True))
        batch.add_column(sa.Column("service_identity_mode", sa.String(16), nullable=False, server_default="external"))
        batch.add_column(sa.Column("ceph_admin_allowed", sa.Boolean(), nullable=False, server_default=sa.false()))
    connection = op.get_bind()
    endpoints = sa.Table("storage_endpoints", sa.MetaData(), autoload_with=connection)
    now = utcnow()
    for row in connection.execute(sa.select(endpoints)).mappings():
        connection.execute(endpoints.update().where(endpoints.c.id == row["id"]).values(identity_namespace=uuid.uuid4().hex))
        for kind in ("supervision", "ceph_admin"):
            access, secret = row[f"{kind}_access_key"], row[f"{kind}_secret_key"]
            if access or secret:
                connection.execute(identities.insert().values(endpoint_id=row["id"], kind=kind, mode="external", access_key=access, secret_key=secret, status="ready" if access and secret else "missing", created_at=now, updated_at=now))
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.alter_column("identity_namespace", nullable=False)
        batch.create_unique_constraint("uq_storage_endpoints_identity_namespace", ["identity_namespace"])
        batch.alter_column("service_identity_mode", server_default="managed")
        for kind in ("supervision", "ceph_admin"):
            batch.drop_column(f"{kind}_access_key")
            batch.drop_column(f"{kind}_secret_key")


def downgrade():
    connection = op.get_bind()
    identities = sa.Table("endpoint_service_identities", sa.MetaData(), autoload_with=connection)
    if connection.scalar(sa.select(sa.func.count()).select_from(identities).where(sa.or_(identities.c.mode == "managed", identities.c.kind == "runtime"))):
        raise RuntimeError("Restore a pre-migration backup to preserve Runtime or managed identity provenance.")
    with op.batch_alter_table("storage_endpoints") as batch:
        for kind in ("supervision", "ceph_admin"):
            batch.add_column(sa.Column(f"{kind}_access_key", sa.String()))
            batch.add_column(sa.Column(f"{kind}_secret_key", sa.String()))
    endpoints = sa.Table("storage_endpoints", sa.MetaData(), autoload_with=connection)
    for row in connection.execute(sa.select(identities)).mappings():
        connection.execute(endpoints.update().where(endpoints.c.id == row["endpoint_id"]).values(**{
            f"{row['kind']}_access_key": row["access_key"], f"{row['kind']}_secret_key": row["secret_key"],
        }))
    op.drop_table("endpoint_service_identities")
    with op.batch_alter_table("storage_endpoints") as batch:
        batch.drop_constraint("uq_storage_endpoints_identity_namespace", type_="unique")
        for column in ("identity_namespace", "service_identity_mode", "ceph_admin_allowed"):
            batch.drop_column(column)
