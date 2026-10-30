# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store Portal request payloads as structured JSON.

Revision ID: 0208_structure_portal_request_payloads
Revises: 0207_structure_bucket_usage_stats_payloads
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0208_structure_portal_request_payloads"
down_revision = "0207_structure_bucket_usage_stats_payloads"
branch_labels = None
depends_on = None


portal_requests = sa.table(
    "portal_admin_requests",
    sa.column("id", sa.Integer()),
    sa.column("payload_json", sa.Text()),
    sa.column("result_json", sa.Text()),
    sa.column("payload", sa.JSON()),
    sa.column("result", sa.JSON()),
)


def _load_object(
    row_id: int,
    field: str,
    raw: object,
    *,
    nullable: bool = False,
) -> dict[str, Any] | None:
    if raw is None:
        if nullable:
            return None
        raise ValueError(f"Portal request {row_id} {field} must contain a JSON object.")
    if not isinstance(raw, str):
        raise ValueError(f"Portal request {row_id} {field} must contain a JSON object.")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Portal request {row_id} {field} contains invalid JSON.") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Portal request {row_id} {field} must contain a JSON object.")
    return payload


def upgrade() -> None:
    op.add_column(
        "portal_admin_requests",
        sa.Column("payload", sa.JSON(), nullable=True),
    )
    op.add_column(
        "portal_admin_requests",
        sa.Column("result", sa.JSON(), nullable=True),
    )

    bind = op.get_bind()
    rows = bind.execute(sa.select(portal_requests)).all()
    for row in rows:
        bind.execute(
            portal_requests.update()
            .where(portal_requests.c.id == row.id)
            .values(
                payload=_load_object(row.id, "payload_json", row.payload_json),
                result=_load_object(
                    row.id,
                    "result_json",
                    row.result_json,
                    nullable=True,
                ),
            )
        )

    with op.batch_alter_table("portal_admin_requests") as batch_op:
        batch_op.alter_column("payload", existing_type=sa.JSON(), nullable=False)
        batch_op.drop_column("payload_json")
        batch_op.drop_column("result_json")


def downgrade() -> None:
    with op.batch_alter_table("portal_admin_requests") as batch_op:
        batch_op.add_column(sa.Column("payload_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("result_json", sa.Text(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.select(portal_requests)).all()
    for row in rows:
        bind.execute(
            portal_requests.update()
            .where(portal_requests.c.id == row.id)
            .values(
                payload_json=json.dumps(
                    row.payload,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                result_json=(
                    json.dumps(
                        row.result,
                        ensure_ascii=True,
                        separators=(",", ":"),
                        sort_keys=True,
                    )
                    if row.result is not None
                    else None
                ),
            )
        )

    with op.batch_alter_table("portal_admin_requests") as batch_op:
        batch_op.alter_column("payload_json", existing_type=sa.Text(), nullable=False)
        batch_op.drop_column("payload")
        batch_op.drop_column("result")
