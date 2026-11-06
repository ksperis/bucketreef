# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize historical onboarding completion into v2 journeys.

Revision ID: 0255_canonical_onboarding_completion
Revises: 0254_canonical_healthcheck_status
Create Date: 2026-11-06
"""

from __future__ import annotations

from uuid import NAMESPACE_URL, uuid5

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0255_canonical_onboarding_completion"
down_revision = "0254_canonical_healthcheck_status"
branch_labels = None
depends_on = None


_CANONICAL_DRAFT = {
    "version": 2,
    "endpoint_id": None,
    "endpoint_url": "",
    "region": "",
    "force_path_style": True,
    "manager": False,
    "portal": False,
    "private_connection": False,
    "ceph_admin": False,
    "supervision": False,
}


def _canonical_journey_id(user_id: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"bucketreef:onboarding-completion:{user_id}"))


def _tables():
    preferences = sa.table(
        "onboarding_preferences",
        sa.column("user_id", sa.Integer()),
        sa.column("initial_setup_completed_at", UTCDateTime()),
    )
    journeys = sa.table(
        "onboarding_journeys",
        sa.column("id", sa.String(36)),
        sa.column("user_id", sa.Integer()),
        sa.column("revision", sa.Integer()),
        sa.column("draft", sa.JSON()),
        sa.column("resources", sa.JSON()),
        sa.column("pending_step", sa.String(40)),
        sa.column("configured_at", UTCDateTime()),
        sa.column("created_at", UTCDateTime()),
        sa.column("updated_at", UTCDateTime()),
    )
    return preferences, journeys


def upgrade() -> None:
    bind = op.get_bind()
    preferences, journeys = _tables()
    existing_users = set(bind.execute(sa.select(journeys.c.user_id)).scalars().all())
    completed = bind.execute(
        sa.select(
            preferences.c.user_id,
            preferences.c.initial_setup_completed_at,
        ).where(preferences.c.initial_setup_completed_at.is_not(None))
    ).all()

    for user_id, completed_at in completed:
        if user_id in existing_users:
            continue
        journey_id = _canonical_journey_id(user_id)
        if bind.scalar(sa.select(sa.func.count()).select_from(journeys).where(journeys.c.id == journey_id)):
            raise RuntimeError(
                f"Canonical onboarding journey id collision for user {user_id}"
            )
        bind.execute(
            journeys.insert().values(
                id=journey_id,
                user_id=user_id,
                revision=1,
                draft=dict(_CANONICAL_DRAFT),
                resources={},
                pending_step=None,
                configured_at=completed_at,
                created_at=completed_at,
                updated_at=completed_at,
            )
        )

    with op.batch_alter_table("onboarding_preferences") as batch_op:
        batch_op.drop_column("initial_setup_completed_at")


def downgrade() -> None:
    with op.batch_alter_table("onboarding_preferences") as batch_op:
        batch_op.add_column(
            sa.Column("initial_setup_completed_at", UTCDateTime(), nullable=True)
        )

    bind = op.get_bind()
    preferences, journeys = _tables()
    user_ids = bind.execute(sa.select(preferences.c.user_id)).scalars().all()
    for user_id in user_ids:
        journey_id = _canonical_journey_id(user_id)
        completed_at = bind.scalar(
            sa.select(journeys.c.configured_at).where(journeys.c.id == journey_id)
        )
        if completed_at is None:
            continue
        bind.execute(
            preferences.update()
            .where(preferences.c.user_id == user_id)
            .values(initial_setup_completed_at=completed_at)
        )
        bind.execute(journeys.delete().where(journeys.c.id == journey_id))
