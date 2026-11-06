# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove the obsolete global onboarding setting.

Revision ID: 0257_remove_obsolete_onboarding_setting
Revises: 0256_canonical_app_settings_security
Create Date: 2026-11-06
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0257_remove_obsolete_onboarding_setting"
down_revision = "0256_canonical_app_settings_security"
branch_labels = None
depends_on = None


_SETTINGS_KEY = "default"
app_settings = sa.table(
    "app_settings",
    sa.column("key", sa.String()),
    sa.column("payload", sa.JSON()),
)


def upgrade() -> None:
    bind = op.get_bind()
    row = bind.execute(
        sa.select(app_settings.c.payload).where(app_settings.c.key == _SETTINGS_KEY)
    ).first()
    if row is None:
        return
    if not isinstance(row.payload, dict):
        raise ValueError("app_settings[default].payload must contain a JSON object")
    if "onboarding" not in row.payload:
        return

    payload = dict(row.payload)
    payload.pop("onboarding")
    bind.execute(
        app_settings.update()
        .where(app_settings.c.key == _SETTINGS_KEY)
        .values(payload=payload)
    )


def downgrade() -> None:
    # Migration 0125 transferred the historical global dismissal into
    # per-user onboarding_preferences. Reintroducing a global value would
    # create a second source of truth.
    pass
