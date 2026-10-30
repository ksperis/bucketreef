# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store user UI preferences as structured JSON.

Revision ID: 0212_structure_user_ui_preferences
Revises: 0211_structure_operation_lease_context
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0212_structure_user_ui_preferences"
down_revision = "0211_structure_operation_lease_context"
branch_labels = None
depends_on = None


users = sa.table(
    "users",
    sa.column("id", sa.Integer()),
    sa.column("ui_preferences_json", sa.Text()),
    sa.column("ui_preferences", sa.JSON()),
)


def _load_preferences(user_id: int, raw: object) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ValueError(f"User {user_id} ui_preferences_json must contain a JSON object.")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"User {user_id} ui_preferences_json contains invalid JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"User {user_id} ui_preferences_json must contain a JSON object.")
    return payload


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("ui_preferences", sa.JSON(), nullable=True),
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(users.c.id, users.c.ui_preferences_json)
    ).all()
    for row in rows:
        bind.execute(
            users.update()
            .where(users.c.id == row.id)
            .values(ui_preferences=_load_preferences(row.id, row.ui_preferences_json))
        )

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "ui_preferences",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("ui_preferences_json")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("ui_preferences_json", sa.Text(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(users.c.id, users.c.ui_preferences)
    ).all()
    for row in rows:
        bind.execute(
            users.update()
            .where(users.c.id == row.id)
            .values(
                ui_preferences_json=json.dumps(
                    row.ui_preferences,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
        )

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column(
            "ui_preferences_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("ui_preferences")
