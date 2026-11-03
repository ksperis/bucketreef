# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Track durable S3 account deletion cleanup.

Revision ID: 0229_s3_account_deletion_state
Revises: 0228_s3_user_deletion_state
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op


revision = "0229_s3_account_deletion_state"
down_revision = "0228_s3_user_deletion_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "s3_account_deletions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("s3_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("rgw_account_id", sa.String(), nullable=False),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
        sa.Column("rgw_tenant", sa.String(), nullable=False, server_default=""),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column(
            "iam_cleanup_completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "root_user_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "remote_account_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "account_id",
            name="uq_s3_account_deletions_account",
        ),
    )
    op.create_index(
        "ix_s3_account_deletions_id",
        "s3_account_deletions",
        ["id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text("SELECT 1 FROM s3_account_deletions LIMIT 1")
    ).first() is not None:
        raise RuntimeError(
            "Complete pending S3 account deletions before downgrading."
        )
    op.drop_index("ix_s3_account_deletions_id", table_name="s3_account_deletions")
    op.drop_table("s3_account_deletions")
