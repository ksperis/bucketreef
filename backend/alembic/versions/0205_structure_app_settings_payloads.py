# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store application settings payloads as structured JSON.

Revision ID: 0205_structure_app_settings_payloads
Revises: 0204_structure_auth_challenge_payloads
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0205_structure_app_settings_payloads"
down_revision = "0204_structure_auth_challenge_payloads"
branch_labels = None
depends_on = None


app_settings = sa.table(
    "app_settings",
    sa.column("key", sa.String()),
    sa.column("payload_json", sa.Text()),
    sa.column("payload", sa.JSON()),
)


def _load_payload(key: str, raw: object) -> Any:
    if not isinstance(raw, str):
        raise ValueError(f"Application setting {key} payload_json must contain valid JSON.")
    try:
        return json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Application setting {key} payload_json contains invalid JSON."
        ) from exc


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("payload", sa.JSON(), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(app_settings.c.key, app_settings.c.payload_json)
    ).all()
    for row in rows:
        bind.execute(
            app_settings.update()
            .where(app_settings.c.key == row.key)
            .values(payload=_load_payload(row.key, row.payload_json))
        )
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.alter_column(
            "payload",
            existing_type=sa.JSON(),
            nullable=False,
        )
        batch_op.drop_column("payload_json")


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("payload_json", sa.Text(), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(sa.select(app_settings.c.key, app_settings.c.payload)).all()
    for row in rows:
        bind.execute(
            app_settings.update()
            .where(app_settings.c.key == row.key)
            .values(
                payload_json=json.dumps(
                    row.payload,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
        )
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.alter_column(
            "payload_json",
            existing_type=sa.Text(),
            nullable=False,
        )
        batch_op.drop_column("payload")
