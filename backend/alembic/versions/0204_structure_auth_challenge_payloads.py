# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store authentication challenge payloads as structured JSON.

Revision ID: 0204_structure_auth_challenge_payloads
Revises: 0203_structure_oidc_provider_lists
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0204_structure_auth_challenge_payloads"
down_revision = "0203_structure_oidc_provider_lists"
branch_labels = None
depends_on = None


auth_challenges = sa.table(
    "auth_challenges",
    sa.column("id", sa.String()),
    sa.column("payload_json", sa.Text()),
    sa.column("payload", sa.JSON()),
)


def _load_payload(challenge_id: str, raw: object) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ValueError(
            f"Authentication challenge {challenge_id} payload_json must contain a JSON object."
        )
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Authentication challenge {challenge_id} payload_json contains invalid JSON."
        ) from exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"Authentication challenge {challenge_id} payload_json must contain a JSON object."
        )
    return payload


def upgrade() -> None:
    op.add_column(
        "auth_challenges",
        sa.Column("payload", sa.JSON(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            auth_challenges.c.id,
            auth_challenges.c.payload_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            auth_challenges.update()
            .where(auth_challenges.c.id == row.id)
            .values(payload=_load_payload(row.id, row.payload_json))
        )
    with op.batch_alter_table("auth_challenges") as batch_op:
        batch_op.alter_column(
            "payload",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("payload_json")


def downgrade() -> None:
    with op.batch_alter_table("auth_challenges") as batch_op:
        batch_op.add_column(
            sa.Column("payload_json", sa.Text(), nullable=True),
        )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(auth_challenges.c.id, auth_challenges.c.payload)
    ).all()
    for row in rows:
        bind.execute(
            auth_challenges.update()
            .where(auth_challenges.c.id == row.id)
            .values(
                payload_json=json.dumps(
                    row.payload,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
        )
    with op.batch_alter_table("auth_challenges") as batch_op:
        batch_op.alter_column(
            "payload_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("payload")
