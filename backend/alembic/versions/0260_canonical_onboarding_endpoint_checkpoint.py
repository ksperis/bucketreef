# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove the duplicated onboarding endpoint id from resource checkpoints.

Revision ID: 0260_onboarding_endpoint_checkpoint
Revises: 0259_onboarding_endpoint_draft
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0260_onboarding_endpoint_checkpoint"
down_revision = "0259_onboarding_endpoint_draft"
branch_labels = None
depends_on = None


def _positive_endpoint_id(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def upgrade() -> None:
    bind = op.get_bind()
    journeys = sa.table(
        "onboarding_journeys",
        sa.column("id", sa.String(36)),
        sa.column("draft", sa.JSON()),
        sa.column("resources", sa.JSON()),
    )

    rows = bind.execute(
        sa.select(journeys.c.id, journeys.c.draft, journeys.c.resources)
    ).mappings()
    for row in rows:
        draft = row["draft"]
        resources = row["resources"]
        if not isinstance(draft, dict) or not isinstance(resources, dict):
            raise ValueError("Onboarding journey draft and resources must be JSON objects")
        if "endpoint_created" in resources and resources["endpoint_created"] is not True:
            raise ValueError("Onboarding endpoint-created checkpoint must be true")
        if "endpoint_id" not in resources:
            continue

        endpoint_id = resources["endpoint_id"]
        if not _positive_endpoint_id(endpoint_id):
            raise ValueError("Onboarding endpoint checkpoint must be a positive integer")
        if draft.get("endpoint_id") != endpoint_id:
            raise ValueError(
                "Onboarding endpoint checkpoint must match the canonical draft endpoint"
            )

        canonical = dict(resources)
        canonical.pop("endpoint_id")
        canonical["endpoint_created"] = True
        bind.execute(
            journeys.update()
            .where(journeys.c.id == row["id"])
            .values(resources=canonical)
        )


def downgrade() -> None:
    bind = op.get_bind()
    journeys = sa.table(
        "onboarding_journeys",
        sa.column("id", sa.String(36)),
        sa.column("draft", sa.JSON()),
        sa.column("resources", sa.JSON()),
    )

    rows = bind.execute(
        sa.select(journeys.c.id, journeys.c.draft, journeys.c.resources)
    ).mappings()
    for row in rows:
        draft = row["draft"]
        resources = row["resources"]
        if not isinstance(draft, dict) or not isinstance(resources, dict):
            raise ValueError("Onboarding journey draft and resources must be JSON objects")
        if resources.get("endpoint_created") is not True:
            continue

        endpoint_id = draft.get("endpoint_id")
        if not _positive_endpoint_id(endpoint_id):
            raise ValueError("Canonical onboarding draft endpoint must be a positive integer")

        legacy = dict(resources)
        legacy.pop("endpoint_created")
        legacy["endpoint_id"] = endpoint_id
        bind.execute(
            journeys.update()
            .where(journeys.c.id == row["id"])
            .values(resources=legacy)
        )
