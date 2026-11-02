# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Enforce canonical user avatar preferences.

Revision ID: 0225_canonical_user_avatar_preference
Revises: 0224_external_identity_provider_invariants
Create Date: 2026-11-02
"""

from alembic import op
import sqlalchemy as sa


revision = "0225_canonical_user_avatar_preference"
down_revision = "0224_external_identity_provider_invariants"
branch_labels = None
depends_on = None


_CANONICAL_PREFERENCES = ("auto", "uploaded", "gravatar", "initials")


def upgrade() -> None:
    users = sa.table(
        "users",
        sa.column("avatar_preference", sa.String()),
    )
    normalized_preference = sa.func.lower(sa.func.trim(users.c.avatar_preference))
    for preference in _CANONICAL_PREFERENCES:
        op.execute(
            users.update()
            .where(normalized_preference == preference)
            .values(avatar_preference=preference)
        )
    op.execute(
        users.update()
        .where(users.c.avatar_preference.notin_(_CANONICAL_PREFERENCES))
        .values(avatar_preference="auto")
    )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_users_avatar_preference",
            "avatar_preference IN ('auto', 'uploaded', 'gravatar', 'initials')",
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("ck_users_avatar_preference", type_="check")
