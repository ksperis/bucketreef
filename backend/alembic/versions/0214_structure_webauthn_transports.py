# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store WebAuthn credential transports as structured JSON.

Revision ID: 0214_structure_webauthn_transports
Revises: 0213_structure_bucket_migration_json
Create Date: 2026-10-30
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0214_structure_webauthn_transports"
down_revision = "0213_structure_bucket_migration_json"
branch_labels = None
depends_on = None


webauthn_credentials = sa.table(
    "webauthn_credentials",
    sa.column("id", sa.String()),
    sa.column("transports_json", sa.Text()),
    sa.column("transports", sa.JSON()),
)


def _load_transports(credential_id: str, raw: object) -> list[str]:
    if not isinstance(raw, str):
        raise ValueError(
            f"WebAuthn credential {credential_id} transports_json must contain a JSON array of strings."
        )
    try:
        transports = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"WebAuthn credential {credential_id} transports_json contains invalid JSON."
        ) from exc
    if not isinstance(transports, list) or any(
        not isinstance(transport, str) for transport in transports
    ):
        raise ValueError(
            f"WebAuthn credential {credential_id} transports_json must contain a JSON array of strings."
        )
    return transports


def _dump_transports(credential_id: str, value: object) -> str:
    if not isinstance(value, list) or any(
        not isinstance(transport, str) for transport in value
    ):
        raise ValueError(
            f"WebAuthn credential {credential_id} transports must contain a JSON array of strings."
        )
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
    )


def upgrade() -> None:
    op.add_column(
        "webauthn_credentials",
        sa.Column("transports", sa.JSON(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            webauthn_credentials.c.id,
            webauthn_credentials.c.transports_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            webauthn_credentials.update()
            .where(webauthn_credentials.c.id == row.id)
            .values(transports=_load_transports(row.id, row.transports_json))
        )
    with op.batch_alter_table("webauthn_credentials") as batch_op:
        batch_op.alter_column(
            "transports",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="[]",
        )
        batch_op.drop_column("transports_json")


def downgrade() -> None:
    with op.batch_alter_table("webauthn_credentials") as batch_op:
        batch_op.add_column(
            sa.Column("transports_json", sa.Text(), nullable=True),
        )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            webauthn_credentials.c.id,
            webauthn_credentials.c.transports,
        )
    ).all()
    for row in rows:
        bind.execute(
            webauthn_credentials.update()
            .where(webauthn_credentials.c.id == row.id)
            .values(
                transports_json=_dump_transports(row.id, row.transports)
            )
        )
    with op.batch_alter_table("webauthn_credentials") as batch_op:
        batch_op.alter_column(
            "transports_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="[]",
        )
        batch_op.drop_column("transports")
