# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persist individual, resumable onboarding journeys without credentials."""
import json
from datetime import datetime, timezone
from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime

revision = "0125_guided_onboarding"
down_revision = "0124_canonical_manager_usage_scopes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "onboarding_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("dismissed", sa.Boolean(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_table(
        "onboarding_journeys",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("draft_json", sa.Text(), nullable=False),
        sa.Column("resources_json", sa.Text(), nullable=False),
        sa.Column("evidence_json", sa.Text(), nullable=False),
        sa.Column("readiness_json", sa.Text(), nullable=False),
        sa.Column("pending_step", sa.String(40), nullable=True),
        sa.Column("configured_at", UTCDateTime(), nullable=True),
        sa.Column("validated_at", UTCDateTime(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    op.create_index("ix_onboarding_journeys_user_id", "onboarding_journeys", ["user_id"])
    # Preserve the legacy dismissal only for administrators present at upgrade.
    # Future administrators start independently; runtime settings no longer act
    # as a global dismissal switch.
    bind = op.get_bind()
    payload = bind.execute(sa.text("SELECT payload_json FROM app_settings WHERE key = 'default'")).scalar()
    dismissed = bool(payload and json.loads(payload).get("onboarding", {}).get("dismissed") is True)
    users = sa.table("users", sa.column("id", sa.Integer()), sa.column("role", sa.String()))
    preferences = sa.table("onboarding_preferences", sa.column("user_id", sa.Integer()),
                           sa.column("dismissed", sa.Boolean()), sa.column("updated_at", UTCDateTime()))
    existing_ids = bind.execute(sa.select(users.c.id).where(users.c.role.in_(["ui_admin", "ui_superadmin"]))).scalars().all()
    if existing_ids:
        now = datetime.now(timezone.utc)
        bind.execute(preferences.insert(), [{"user_id": user_id, "dismissed": dismissed, "updated_at": now} for user_id in existing_ids])


def downgrade() -> None:
    op.drop_index("ix_onboarding_journeys_user_id", table_name="onboarding_journeys")
    op.drop_table("onboarding_journeys")
    op.drop_table("onboarding_preferences")
