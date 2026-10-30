# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store webhook delivery payloads as structured JSON.

Revision ID: 0216_structure_webhook_delivery_payloads
Revises: 0215_structure_audit_metadata
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0216_structure_webhook_delivery_payloads"
down_revision = "0215_structure_audit_metadata"
branch_labels = None
depends_on = None


webhook_deliveries = sa.table(
    "webhook_deliveries",
    sa.column("id", sa.Integer()),
    sa.column("payload_json", sa.Text()),
    sa.column("payload", sa.JSON()),
)


def _load_payload(delivery_id: int, raw: object) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ValueError(
            f"Webhook delivery {delivery_id} payload_json must contain a JSON object."
        )
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Webhook delivery {delivery_id} payload_json contains invalid JSON."
        ) from exc
    if not isinstance(value, dict):
        raise ValueError(
            f"Webhook delivery {delivery_id} payload_json must contain a JSON object."
        )
    return value


def _dump_payload(delivery_id: int, value: object) -> str:
    if not isinstance(value, dict):
        raise ValueError(
            f"Webhook delivery {delivery_id} payload must contain a JSON object."
        )
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def upgrade() -> None:
    op.add_column(
        "webhook_deliveries",
        sa.Column("payload", sa.JSON(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            webhook_deliveries.c.id,
            webhook_deliveries.c.payload_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            webhook_deliveries.update()
            .where(webhook_deliveries.c.id == row.id)
            .values(payload=_load_payload(row.id, row.payload_json))
        )
    with op.batch_alter_table("webhook_deliveries") as batch_op:
        batch_op.alter_column(
            "payload",
            existing_type=sa.JSON(),
            nullable=False,
        )
        batch_op.drop_column("payload_json")


def downgrade() -> None:
    op.add_column(
        "webhook_deliveries",
        sa.Column("payload_json", sa.Text(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            webhook_deliveries.c.id,
            webhook_deliveries.c.payload,
        )
    ).all()
    for row in rows:
        bind.execute(
            webhook_deliveries.update()
            .where(webhook_deliveries.c.id == row.id)
            .values(payload_json=_dump_payload(row.id, row.payload))
        )
    with op.batch_alter_table("webhook_deliveries") as batch_op:
        batch_op.alter_column(
            "payload_json",
            existing_type=sa.Text(),
            nullable=False,
        )
        batch_op.drop_column("payload")
