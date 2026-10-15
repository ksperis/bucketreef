# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Move pending retirements to an encrypted rotation journal without decrypting."""
from datetime import UTC, datetime

import sqlalchemy as sa
import yaml
from alembic import op
from app.db.utc_datetime import UTCDateTime

revision = "0141_durable_key_rotation"
down_revision = "0140_runtime_identity_mode_source"
branch_labels = None
depends_on = None

_FEATURE_KEYS = frozenset({
    "admin",
    "account",
    "sts",
    "usage",
    "metrics",
    "static_website",
    "iam",
    "sns",
    "sse",
    "replication",
    "healthcheck",
})
_ENDPOINT_FEATURE_KEYS = frozenset({"admin", "iam", "sts"})


def _normalize_url(value):
    if value is None:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def _resolve_rgw_admin_api_endpoint(endpoint_url, raw_features_config):
    if not raw_features_config or not raw_features_config.strip():
        return endpoint_url
    try:
        data = yaml.safe_load(raw_features_config)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid endpoint features YAML.") from exc
    if not isinstance(data, dict):
        raise ValueError("Endpoint features YAML must be a mapping.")
    if set(data) != {"features"}:
        raise ValueError(
            "Endpoint features YAML must contain only the top-level 'features' mapping."
        )
    features = data["features"]
    if not isinstance(features, dict):
        raise ValueError("Endpoint features must be a mapping.")
    unknown_features = set(features).difference(_FEATURE_KEYS)
    if unknown_features:
        labels = ", ".join(sorted(str(key) for key in unknown_features))
        raise ValueError(f"Unknown endpoint feature(s): {labels}.")

    admin_endpoint = None
    for key, value in features.items():
        if not isinstance(value, dict):
            raise ValueError(f"Feature '{key}' must be a mapping.")
        allowed_fields = {"enabled"}
        if key in _ENDPOINT_FEATURE_KEYS:
            allowed_fields.add("endpoint")
        if key == "healthcheck":
            allowed_fields.update({"healthcheck_url", "mode"})
        unknown_fields = set(value).difference(allowed_fields)
        if unknown_fields:
            labels = ", ".join(sorted(str(field) for field in unknown_fields))
            raise ValueError(f"Unknown field(s) for feature '{key}': {labels}.")
        if "enabled" in value and not isinstance(value.get("enabled"), bool):
            raise ValueError(f"Feature '{key}.enabled' must be a boolean.")
        if key in _ENDPOINT_FEATURE_KEYS and "endpoint" in value:
            configured_endpoint = value.get("endpoint")
            if configured_endpoint is not None and not isinstance(configured_endpoint, str):
                raise ValueError(f"Feature '{key}.endpoint' must be a string.")
            if key == "admin":
                admin_endpoint = _normalize_url(configured_endpoint)
        if key == "healthcheck":
            if "mode" in value:
                mode = value.get("mode")
                if not isinstance(mode, str):
                    raise ValueError("Feature 'healthcheck.mode' must be a string.")
                if mode.strip().lower() not in {"http", "s3"}:
                    raise ValueError("Feature 'healthcheck.mode' must be 'http' or 's3'.")
            if "healthcheck_url" in value:
                healthcheck_url = value.get("healthcheck_url")
                if healthcheck_url is not None and not isinstance(healthcheck_url, str):
                    raise ValueError("Feature 'healthcheck.healthcheck_url' must be a string.")

    return admin_endpoint or endpoint_url


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
    now = datetime.now(UTC)
    for row in connection.execute(sa.select(identities, endpoints.c.endpoint_url, endpoints.c.features_config).join(endpoints, identities.c.endpoint_id == endpoints.c.id).where(identities.c.previous_access_key.is_not(None))).mappings():
        if not row["rgw_uid"] or not row["access_key"] or not row["secret_key"]:
            raise RuntimeError("A pending service rotation has incomplete credentials; repair it before upgrading.")
        connection.execute(journal.insert().values(
            endpoint_id=row["endpoint_id"], key_type="ceph_admin" if row["kind"] == "ceph_admin" else f"endpoint_{row['kind']}",
            target_id=row["id"], rgw_uid=row["rgw_uid"], rgw_endpoint=_resolve_rgw_admin_api_endpoint(row["endpoint_url"], row["features_config"]),
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
