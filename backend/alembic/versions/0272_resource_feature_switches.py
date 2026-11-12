"""Add managed resource and S3 connection feature switches."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0272_resource_feature_switches"
down_revision = "0271_deployment_configuration"
branch_labels = None
depends_on = None


_SETTINGS_KEY = "default"
_EXISTING_INSTALLATION_DEFAULTS = {
    "managed_rgw_accounts_enabled": True,
    "managed_rgw_users_enabled": True,
    "shared_s3_connections_enabled": True,
    "private_s3_connections_enabled": True,
}

app_settings = sa.table(
    "app_settings",
    sa.column("key", sa.String()),
    sa.column("payload", sa.JSON()),
)


def _canonicalize_payload(raw: object) -> tuple[dict, bool]:
    if not isinstance(raw, dict):
        raise ValueError("app_settings[default].payload must contain a JSON object")

    payload = dict(raw)
    raw_general = payload.get("general", {})
    if not isinstance(raw_general, dict):
        raise ValueError("app_settings[default].payload.general must contain a JSON object")
    general = dict(raw_general)
    changed = False
    for field, default in _EXISTING_INSTALLATION_DEFAULTS.items():
        if field in general:
            if not isinstance(general[field], bool):
                raise ValueError(
                    f"app_settings[default].payload.general.{field} must be a boolean"
                )
            continue
        general[field] = default
        changed = True

    if changed:
        payload["general"] = general
    return payload, changed


def upgrade() -> None:
    bind = op.get_bind()
    row = bind.execute(
        sa.select(app_settings.c.payload).where(app_settings.c.key == _SETTINGS_KEY)
    ).first()
    if row is None:
        return

    payload, changed = _canonicalize_payload(row.payload)
    if changed:
        bind.execute(
            app_settings.update()
            .where(app_settings.c.key == _SETTINGS_KEY)
            .values(payload=payload)
        )


def downgrade() -> None:
    # Existing values cannot be distinguished from values materialized here.
    pass
