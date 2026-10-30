# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store onboarding journey state as structured JSON.

Revision ID: 0206_structure_onboarding_journey_payloads
Revises: 0205_structure_app_settings_payloads
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0206_structure_onboarding_journey_payloads"
down_revision = "0205_structure_app_settings_payloads"
branch_labels = None
depends_on = None


onboarding_journeys = sa.table(
    "onboarding_journeys",
    sa.column("id", sa.String()),
    sa.column("draft_json", sa.Text()),
    sa.column("resources_json", sa.Text()),
    sa.column("draft", sa.JSON()),
    sa.column("resources", sa.JSON()),
)


def _load_object(journey_id: str, field: str, raw: object) -> dict[str, Any]:
    if not isinstance(raw, str):
        raise ValueError(
            f"Onboarding journey {journey_id} {field} must contain a JSON object."
        )
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Onboarding journey {journey_id} {field} contains invalid JSON."
        ) from exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"Onboarding journey {journey_id} {field} must contain a JSON object."
        )
    return payload


def upgrade() -> None:
    op.add_column("onboarding_journeys", sa.Column("draft", sa.JSON(), nullable=True))
    op.add_column("onboarding_journeys", sa.Column("resources", sa.JSON(), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            onboarding_journeys.c.id,
            onboarding_journeys.c.draft_json,
            onboarding_journeys.c.resources_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            onboarding_journeys.update()
            .where(onboarding_journeys.c.id == row.id)
            .values(
                draft=_load_object(row.id, "draft_json", row.draft_json),
                resources=_load_object(row.id, "resources_json", row.resources_json),
            )
        )
    with op.batch_alter_table("onboarding_journeys") as batch_op:
        batch_op.alter_column("draft", existing_type=sa.JSON(), nullable=False)
        batch_op.alter_column(
            "resources",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="{}",
        )
        batch_op.drop_column("draft_json")
        batch_op.drop_column("resources_json")


def downgrade() -> None:
    with op.batch_alter_table("onboarding_journeys") as batch_op:
        batch_op.add_column(sa.Column("draft_json", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("resources_json", sa.Text(), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            onboarding_journeys.c.id,
            onboarding_journeys.c.draft,
            onboarding_journeys.c.resources,
        )
    ).all()
    for row in rows:
        bind.execute(
            onboarding_journeys.update()
            .where(onboarding_journeys.c.id == row.id)
            .values(
                draft_json=json.dumps(
                    row.draft,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
                resources_json=json.dumps(
                    row.resources,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                ),
            )
        )
    with op.batch_alter_table("onboarding_journeys") as batch_op:
        batch_op.alter_column("draft_json", existing_type=sa.Text(), nullable=False)
        batch_op.alter_column(
            "resources_json",
            existing_type=sa.Text(),
            nullable=False,
        )
        batch_op.drop_column("draft")
        batch_op.drop_column("resources")
