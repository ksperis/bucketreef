# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Materialize canonical application security settings.

Revision ID: 0256_canonical_app_settings_security
Revises: 0255_canonical_onboarding_completion
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0256_canonical_app_settings_security"
down_revision = "0255_canonical_onboarding_completion"
branch_labels = None
depends_on = None


_SETTINGS_KEY = "default"
_CANONICAL_SECURITY_DEFAULTS = {
    "require_passkey_for_admins": False,
    "require_passkey_for_users": False,
    "allow_user_profile_name_edit": False,
    "allow_user_external_identity_link": False,
    "allow_user_external_identity_unlink": False,
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
    if "general" not in payload:
        general: dict = {}
        changed = True
    else:
        raw_general = payload["general"]
        if not isinstance(raw_general, dict):
            raise ValueError("app_settings[default].payload.general must contain a JSON object")
        general = dict(raw_general)
        changed = False
    for field, default in _CANONICAL_SECURITY_DEFAULTS.items():
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
    # The migration cannot distinguish fields that predated this revision from
    # fields inserted to materialize the runtime defaults.
    pass
