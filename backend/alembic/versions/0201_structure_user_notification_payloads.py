# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store user notification payloads as structured JSON.

Revision ID: 0201_structure_user_notification_payloads
Revises: 0200_structure_storage_endpoint_features
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0201_structure_user_notification_payloads"
down_revision = "0200_structure_storage_endpoint_features"
branch_labels = None
depends_on = None


user_notifications = sa.table(
    "user_notifications",
    sa.column("id", sa.Integer()),
    sa.column("payload_json", sa.Text()),
    sa.column("payload", sa.JSON()),
)


def _load_payload(notification_id: int, raw: object) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ValueError(
            f"User notification {notification_id} payload_json must contain a JSON object."
        )
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"User notification {notification_id} payload_json contains invalid JSON."
        ) from exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"User notification {notification_id} payload_json must contain a JSON object."
        )
    return payload


def upgrade() -> None:
    op.add_column(
        "user_notifications",
        sa.Column("payload", sa.JSON(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            user_notifications.c.id,
            user_notifications.c.payload_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            user_notifications.update()
            .where(user_notifications.c.id == row.id)
            .values(payload=_load_payload(row.id, row.payload_json))
        )
    with op.batch_alter_table("user_notifications") as batch_op:
        batch_op.alter_column(
            "payload",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("payload_json")


def downgrade() -> None:
    with op.batch_alter_table("user_notifications") as batch_op:
        batch_op.add_column(
            sa.Column("payload_json", sa.Text(), nullable=True),
        )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(user_notifications.c.id, user_notifications.c.payload)
    ).all()
    for row in rows:
        bind.execute(
            user_notifications.update()
            .where(user_notifications.c.id == row.id)
            .values(
                payload_json=json.dumps(
                    row.payload,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
        )
    with op.batch_alter_table("user_notifications") as batch_op:
        batch_op.alter_column(
            "payload_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("payload")
