# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store API token scopes as structured JSON.

Revision ID: 0202_structure_api_token_scopes
Revises: 0201_structure_user_notification_payloads
Create Date: 2026-10-30
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0202_structure_api_token_scopes"
down_revision = "0201_structure_user_notification_payloads"
branch_labels = None
depends_on = None


api_tokens = sa.table(
    "api_tokens",
    sa.column("id", sa.String()),
    sa.column("scopes_json", sa.Text()),
    sa.column("scopes", sa.JSON()),
)


def _load_scopes(token_id: str, raw: object) -> list[str]:
    if not isinstance(raw, str):
        raise ValueError(
            f"API token {token_id} scopes_json must contain a JSON array of strings."
        )
    try:
        scopes = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"API token {token_id} scopes_json contains invalid JSON."
        ) from exc
    if not isinstance(scopes, list) or any(
        not isinstance(scope, str) for scope in scopes
    ):
        raise ValueError(
            f"API token {token_id} scopes_json must contain a JSON array of strings."
        )
    return scopes


def upgrade() -> None:
    op.add_column(
        "api_tokens",
        sa.Column("scopes", sa.JSON(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            api_tokens.c.id,
            api_tokens.c.scopes_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            api_tokens.update()
            .where(api_tokens.c.id == row.id)
            .values(scopes=_load_scopes(row.id, row.scopes_json))
        )
    with op.batch_alter_table("api_tokens") as batch_op:
        batch_op.alter_column(
            "scopes",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="[]",
        )
        batch_op.drop_column("scopes_json")


def downgrade() -> None:
    with op.batch_alter_table("api_tokens") as batch_op:
        batch_op.add_column(
            sa.Column("scopes_json", sa.Text(), nullable=True),
        )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(api_tokens.c.id, api_tokens.c.scopes)
    ).all()
    for row in rows:
        bind.execute(
            api_tokens.update()
            .where(api_tokens.c.id == row.id)
            .values(
                scopes_json=json.dumps(
                    row.scopes,
                    ensure_ascii=True,
                    separators=(",", ":"),
                )
            )
        )
    with op.batch_alter_table("api_tokens") as batch_op:
        batch_op.alter_column(
            "scopes_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="[]",
        )
        batch_op.drop_column("scopes")
