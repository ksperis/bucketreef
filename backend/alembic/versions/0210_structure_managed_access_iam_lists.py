# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store managed private access IAM state as structured JSON lists.

Revision ID: 0210_structure_managed_access_iam_lists
Revises: 0209_rgw_multisite_resource_switching
Create Date: 2026-10-30
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0210_structure_managed_access_iam_lists"
down_revision = "0209_rgw_multisite_resource_switching"
branch_labels = None
depends_on = None


IAM_LISTS = (
    ("iam_groups_json", "iam_groups"),
    ("iam_managed_policies_json", "iam_managed_policies"),
    ("iam_inline_policy_names_json", "iam_inline_policy_names"),
)


managed_accesses = sa.table(
    "managed_private_accesses",
    sa.column("id", sa.Integer()),
    *[sa.column(old, sa.Text()) for old, _new in IAM_LISTS],
    *[sa.column(new, sa.JSON()) for _old, new in IAM_LISTS],
)


def _load_string_list(row_id: int, field: str, raw: object) -> list[str]:
    if not isinstance(raw, str):
        raise ValueError(f"Managed private access {row_id} {field} must contain a JSON list.")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Managed private access {row_id} {field} contains invalid JSON.") from exc
    if not isinstance(payload, list) or any(
        not isinstance(item, str) or not item for item in payload
    ):
        raise ValueError(
            f"Managed private access {row_id} {field} must contain non-empty strings."
        )
    return payload


def upgrade() -> None:
    for _old, new in IAM_LISTS:
        op.add_column(
            "managed_private_accesses",
            sa.Column(new, sa.JSON(), nullable=True),
        )

    bind = op.get_bind()
    rows = bind.execute(sa.select(managed_accesses)).all()
    for row in rows:
        bind.execute(
            managed_accesses.update()
            .where(managed_accesses.c.id == row.id)
            .values(
                **{
                    new: _load_string_list(row.id, old, getattr(row, old))
                    for old, new in IAM_LISTS
                }
            )
        )

    with op.batch_alter_table("managed_private_accesses") as batch_op:
        for old, new in IAM_LISTS:
            batch_op.alter_column(
                new,
                existing_type=sa.JSON(),
                nullable=False,
                server_default="[]",
            )
            batch_op.drop_column(old)


def downgrade() -> None:
    with op.batch_alter_table("managed_private_accesses") as batch_op:
        for old, _new in IAM_LISTS:
            batch_op.add_column(sa.Column(old, sa.Text(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.select(managed_accesses)).all()
    for row in rows:
        bind.execute(
            managed_accesses.update()
            .where(managed_accesses.c.id == row.id)
            .values(
                **{
                    old: json.dumps(
                        getattr(row, new),
                        ensure_ascii=True,
                        separators=(",", ":"),
                    )
                    for old, new in IAM_LISTS
                }
            )
        )

    with op.batch_alter_table("managed_private_accesses") as batch_op:
        for old, _new in IAM_LISTS:
            batch_op.alter_column(
                old,
                existing_type=sa.Text(),
                nullable=False,
                server_default="[]",
            )
        for _old, new in IAM_LISTS:
            batch_op.drop_column(new)
