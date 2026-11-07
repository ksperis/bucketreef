# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize onboarding endpoint checkpoints into journey drafts.

Revision ID: 0259_onboarding_endpoint_draft
Revises: 0258_canonical_static_app_settings
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0259_onboarding_endpoint_draft"
down_revision = "0258_canonical_static_app_settings"
branch_labels = None
depends_on = None


def _canonical_draft(draft: object, resources: object) -> dict:
    if not isinstance(draft, dict) or not isinstance(resources, dict):
        raise ValueError("Onboarding journey draft and resources must be JSON objects")

    endpoint_id = resources.get("endpoint_id")
    if endpoint_id is None:
        return draft
    if (
        isinstance(endpoint_id, bool)
        or not isinstance(endpoint_id, int)
        or endpoint_id <= 0
    ):
        raise ValueError("Onboarding endpoint checkpoint must be a positive integer")

    canonical = dict(draft)
    canonical["endpoint_id"] = endpoint_id
    canonical["endpoint_url"] = ""
    return canonical


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
        canonical = _canonical_draft(row["draft"], row["resources"])
        if canonical == row["draft"]:
            continue
        bind.execute(
            journeys.update()
            .where(journeys.c.id == row["id"])
            .values(draft=canonical)
        )


def downgrade() -> None:
    # Canonical drafts are also valid for the previous runtime fallback.
    pass
