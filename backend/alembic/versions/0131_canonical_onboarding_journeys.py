# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove pre-v2 onboarding journeys after preserving completion state.

Revision ID: 0131_canonical_onboarding_journeys
Revises: 0130_canonical_admin_passkey_policy
Create Date: 2026-09-25
"""

from __future__ import annotations

from datetime import datetime
import json

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0131_canonical_onboarding_journeys"
down_revision = "0130_canonical_admin_passkey_policy"
branch_labels = None
depends_on = None


def _is_current_journey(raw: object) -> bool:
    if not isinstance(raw, str):
        return False
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return False
    return isinstance(payload, dict) and payload.get("version") == 2


def upgrade() -> None:
    with op.batch_alter_table("onboarding_preferences", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("initial_setup_completed_at", UTCDateTime(), nullable=True)
        )

    bind = op.get_bind()
    journeys = sa.table(
        "onboarding_journeys",
        sa.column("id", sa.String()),
        sa.column("user_id", sa.Integer()),
        sa.column("draft_json", sa.Text()),
        sa.column("configured_at", UTCDateTime()),
    )
    preferences = sa.table(
        "onboarding_preferences",
        sa.column("user_id", sa.Integer()),
        sa.column("dismissed", sa.Boolean()),
        sa.column("initial_setup_completed_at", UTCDateTime()),
        sa.column("updated_at", UTCDateTime()),
    )

    rows = bind.execute(
        sa.select(
            journeys.c.id,
            journeys.c.user_id,
            journeys.c.draft_json,
            journeys.c.configured_at,
        )
    ).mappings().all()
    legacy_ids: list[str] = []
    completed_by_user: dict[int, datetime] = {}
    for row in rows:
        if _is_current_journey(row["draft_json"]):
            continue
        legacy_ids.append(row["id"])
        configured_at = row["configured_at"]
        if configured_at is None:
            continue
        previous = completed_by_user.get(row["user_id"])
        if previous is None or configured_at > previous:
            completed_by_user[row["user_id"]] = configured_at

    existing_preferences = set(
        bind.execute(sa.select(preferences.c.user_id)).scalars().all()
    )
    for user_id, completed_at in completed_by_user.items():
        if user_id in existing_preferences:
            bind.execute(
                preferences.update()
                .where(preferences.c.user_id == user_id)
                .values(initial_setup_completed_at=completed_at)
            )
            continue
        bind.execute(
            preferences.insert().values(
                user_id=user_id,
                dismissed=False,
                initial_setup_completed_at=completed_at,
                updated_at=completed_at,
            )
        )

    if legacy_ids:
        bind.execute(journeys.delete().where(journeys.c.id.in_(legacy_ids)))


def downgrade() -> None:
    # Removed pre-v2 journey drafts cannot be reconstructed. Their completion
    # state is intentionally discarded when downgrading before this boundary.
    with op.batch_alter_table("onboarding_preferences", schema=None) as batch_op:
        batch_op.drop_column("initial_setup_completed_at")
