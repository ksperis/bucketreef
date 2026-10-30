# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store account Portal settings overrides as structured JSON.

Revision ID: 0217_structure_portal_settings_override
Revises: 0216_structure_webhook_delivery_payloads
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0217_structure_portal_settings_override"
down_revision = "0216_structure_webhook_delivery_payloads"
branch_labels = None
depends_on = None


legacy_accounts = sa.table(
    "s3_accounts",
    sa.column("id", sa.Integer()),
    sa.column("portal_settings_override", sa.Text()),
    sa.column("portal_settings_override_structured", sa.JSON(none_as_null=True)),
)

structured_accounts = sa.table(
    "s3_accounts",
    sa.column("id", sa.Integer()),
    sa.column("portal_settings_override", sa.JSON(none_as_null=True)),
    sa.column("portal_settings_override_text", sa.Text()),
)


def _load_override(account_id: int, raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError(
            f"S3 account {account_id} portal_settings_override must contain a JSON object."
        )
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"S3 account {account_id} portal_settings_override contains invalid JSON."
        ) from exc
    if not isinstance(value, dict):
        raise ValueError(
            f"S3 account {account_id} portal_settings_override must contain a JSON object."
        )
    return value


def _dump_override(account_id: int, value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(
            f"S3 account {account_id} portal_settings_override must contain a JSON object."
        )
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def upgrade() -> None:
    op.add_column(
        "s3_accounts",
        sa.Column(
            "portal_settings_override_structured",
            sa.JSON(none_as_null=True),
            nullable=True,
        ),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            legacy_accounts.c.id,
            legacy_accounts.c.portal_settings_override,
        )
    ).all()
    for row in rows:
        bind.execute(
            legacy_accounts.update()
            .where(legacy_accounts.c.id == row.id)
            .values(
                portal_settings_override_structured=_load_override(
                    row.id,
                    row.portal_settings_override,
                )
            )
        )
    with op.batch_alter_table("s3_accounts") as batch_op:
        batch_op.drop_column("portal_settings_override")
        batch_op.alter_column(
            "portal_settings_override_structured",
            existing_type=sa.JSON(none_as_null=True),
            new_column_name="portal_settings_override",
            nullable=True,
        )


def downgrade() -> None:
    op.add_column(
        "s3_accounts",
        sa.Column("portal_settings_override_text", sa.Text(), nullable=True),
    )
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            structured_accounts.c.id,
            structured_accounts.c.portal_settings_override,
        )
    ).all()
    for row in rows:
        bind.execute(
            structured_accounts.update()
            .where(structured_accounts.c.id == row.id)
            .values(
                portal_settings_override_text=_dump_override(
                    row.id,
                    row.portal_settings_override,
                )
            )
        )
    with op.batch_alter_table("s3_accounts") as batch_op:
        batch_op.drop_column("portal_settings_override")
        batch_op.alter_column(
            "portal_settings_override_text",
            existing_type=sa.Text(),
            new_column_name="portal_settings_override",
            nullable=True,
        )
