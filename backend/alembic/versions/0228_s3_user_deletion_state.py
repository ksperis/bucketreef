# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Track durable S3 user deletion cleanup.

Revision ID: 0228_s3_user_deletion_state
Revises: 0227_portal_iam_revocation_state
Create Date: 2026-11-03
"""

import sqlalchemy as sa
from alembic import op


revision = "0228_s3_user_deletion_state"
down_revision = "0227_portal_iam_revocation_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "s3_user_deletions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "s3_user_id",
            sa.Integer(),
            sa.ForeignKey("s3_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
        sa.Column("rgw_tenant", sa.String(), nullable=False, server_default=""),
        sa.Column("access_key_id", sa.String(), nullable=True),
        sa.Column(
            "remote_completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "mode IN ('access_key', 'remote_user')",
            name="ck_s3_user_deletions_mode",
        ),
        sa.UniqueConstraint(
            "s3_user_id",
            name="uq_s3_user_deletions_s3_user",
        ),
    )
    op.create_index(
        "ix_s3_user_deletions_id",
        "s3_user_deletions",
        ["id"],
    )
    op.create_index(
        "ix_s3_user_deletions_remote_completed",
        "s3_user_deletions",
        ["remote_completed"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text("SELECT 1 FROM s3_user_deletions LIMIT 1")
    ).first() is not None:
        raise RuntimeError(
            "Complete pending S3 user deletions before downgrading."
        )
    op.drop_index(
        "ix_s3_user_deletions_remote_completed",
        table_name="s3_user_deletions",
    )
    op.drop_index("ix_s3_user_deletions_id", table_name="s3_user_deletions")
    op.drop_table("s3_user_deletions")
