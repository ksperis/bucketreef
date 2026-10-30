# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store backend operation lease context as structured JSON.

Revision ID: 0211_structure_operation_lease_context
Revises: 0210_structure_managed_access_iam_lists
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0211_structure_operation_lease_context"
down_revision = "0210_structure_managed_access_iam_lists"
branch_labels = None
depends_on = None


operation_leases = sa.table(
    "backend_operation_leases",
    sa.column("operation_name", sa.String()),
    sa.column("metadata_json", sa.Text()),
    sa.column("lease_context", sa.JSON()),
)


def _load_context(operation_name: str, raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError(
            f"Backend operation lease {operation_name} metadata_json must contain a JSON object."
        )
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Backend operation lease {operation_name} metadata_json contains invalid JSON."
        ) from exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"Backend operation lease {operation_name} metadata_json must contain a JSON object."
        )
    return payload


def upgrade() -> None:
    op.add_column(
        "backend_operation_leases",
        sa.Column("lease_context", sa.JSON(), nullable=True),
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            operation_leases.c.operation_name,
            operation_leases.c.metadata_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            operation_leases.update()
            .where(operation_leases.c.operation_name == row.operation_name)
            .values(
                lease_context=_load_context(
                    row.operation_name,
                    row.metadata_json,
                )
            )
        )

    with op.batch_alter_table("backend_operation_leases") as batch_op:
        batch_op.drop_column("metadata_json")


def downgrade() -> None:
    with op.batch_alter_table("backend_operation_leases") as batch_op:
        batch_op.add_column(sa.Column("metadata_json", sa.Text(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            operation_leases.c.operation_name,
            operation_leases.c.lease_context,
        )
    ).all()
    for row in rows:
        bind.execute(
            operation_leases.update()
            .where(operation_leases.c.operation_name == row.operation_name)
            .values(
                metadata_json=(
                    json.dumps(
                        row.lease_context,
                        ensure_ascii=True,
                        separators=(",", ":"),
                        sort_keys=True,
                    )
                    if row.lease_context is not None
                    else None
                )
            )
        )

    with op.batch_alter_table("backend_operation_leases") as batch_op:
        batch_op.drop_column("lease_context")
