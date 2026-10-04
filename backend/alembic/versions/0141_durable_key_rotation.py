# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Move pending retirements to an encrypted rotation journal without decrypting."""
import sqlalchemy as sa
from alembic import op
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow

revision = "0141_durable_key_rotation"
down_revision = "0140_runtime_identity_mode_source"
branch_labels = None
depends_on = None


def upgrade():
    journal = op.create_table(
        "key_rotation_intents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("rgw_uid", sa.String(), nullable=False),
        sa.Column("tenant", sa.String()),
        sa.Column("rgw_endpoint", sa.String(), nullable=False),
        sa.Column("old_access_key", sa.String(), nullable=False),
        sa.Column("new_access_key", sa.String(), nullable=False),
        sa.Column("new_secret_key", sa.String(), nullable=False),
        sa.Column("deactivate_only", sa.Boolean(), nullable=False),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("actor_email", sa.String(), nullable=False),
        sa.Column("last_error", sa.String(256)),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("endpoint_id", "key_type", "target_id", name="uq_key_rotation_intent_target"),
        sa.CheckConstraint("phase IN ('prepared', 'activated')", name="ck_key_rotation_intent_phase"),
        sa.CheckConstraint("key_type IN ('endpoint_admin', 'endpoint_runtime', 'endpoint_supervision', 'ceph_admin', 'account', 's3_user')", name="ck_key_rotation_intent_type"),
    )
    op.create_index("ix_key_rotation_intents_endpoint_id", "key_rotation_intents", ["endpoint_id"])
    connection = op.get_bind()
    metadata = sa.MetaData()
    identities = sa.Table("endpoint_service_identities", metadata, autoload_with=connection)
    endpoints = sa.Table("storage_endpoints", metadata, autoload_with=connection)
    # Resolve the same Admin API URL as the runtime without reading any secret.
    from types import SimpleNamespace
    from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
    now = utcnow()
    for row in connection.execute(sa.select(identities, endpoints.c.endpoint_url, endpoints.c.features_config).join(endpoints, identities.c.endpoint_id == endpoints.c.id).where(identities.c.previous_access_key.is_not(None))).mappings():
        if not row["rgw_uid"] or not row["access_key"] or not row["secret_key"]:
            raise RuntimeError("A pending service rotation has incomplete credentials; repair it before upgrading.")
        endpoint = SimpleNamespace(endpoint_url=row["endpoint_url"], features_config=row["features_config"], provider="ceph", region=None)
        connection.execute(journal.insert().values(
            endpoint_id=row["endpoint_id"], key_type="ceph_admin" if row["kind"] == "ceph_admin" else f"endpoint_{row['kind']}",
            target_id=row["id"], rgw_uid=row["rgw_uid"], rgw_endpoint=resolve_rgw_admin_api_endpoint(endpoint),
            old_access_key=row["previous_access_key"], new_access_key=row["access_key"], new_secret_key=row["secret_key"],
            deactivate_only=False, phase="activated", actor_email="system", last_error=row["last_error"], created_at=now, updated_at=now,
        ))
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_column("previous_access_key")


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT COUNT(*) FROM key_rotation_intents")):
        raise RuntimeError("Finish pending rotations before downgrading; restore a backup otherwise.")
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.add_column(sa.Column("previous_access_key", sa.String()))
    op.drop_table("key_rotation_intents")
