# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store audit metadata as structured JSON.

Revision ID: 0215_structure_audit_metadata
Revises: 0214_structure_webauthn_transports
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0215_structure_audit_metadata"
down_revision = "0214_structure_webauthn_transports"
branch_labels = None
depends_on = None


audit_logs = sa.table(
    "audit_logs",
    sa.column("id", sa.Integer()),
    sa.column("metadata_json", sa.Text()),
    sa.column("metadata", sa.JSON()),
)


def _load_metadata(row_id: int, raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError(
            f"Audit log {row_id} metadata_json must contain a JSON object."
        )
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Audit log {row_id} metadata_json contains invalid JSON."
        ) from exc
    if not isinstance(value, dict):
        raise ValueError(
            f"Audit log {row_id} metadata_json must contain a JSON object."
        )
    return value


def _dump_metadata(row_id: int, value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(
            f"Audit log {row_id} metadata must contain a JSON object."
        )
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def upgrade() -> None:
    op.add_column(
        "audit_logs",
        sa.Column("metadata", sa.JSON(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            audit_logs.c.id,
            audit_logs.c.metadata_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            audit_logs.update()
            .where(audit_logs.c.id == row.id)
            .values(metadata=_load_metadata(row.id, row.metadata_json))
        )
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.drop_column("metadata_json")


def downgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.add_column(
            sa.Column("metadata_json", sa.Text(), nullable=True),
        )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            audit_logs.c.id,
            audit_logs.c.metadata,
        )
    ).all()
    for row in rows:
        bind.execute(
            audit_logs.update()
            .where(audit_logs.c.id == row.id)
            .values(metadata_json=_dump_metadata(row.id, row.metadata))
        )
    with op.batch_alter_table("audit_logs") as batch_op:
        batch_op.drop_column("metadata")
