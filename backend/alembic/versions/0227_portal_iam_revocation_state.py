# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Track durable Portal IAM user revocation cleanup.

Revision ID: 0227_portal_iam_revocation_state
Revises: 0226_portal_external_credential_revocation
Create Date: 2026-11-03
"""

import sqlalchemy as sa
from alembic import op


revision = "0227_portal_iam_revocation_state"
down_revision = "0226_portal_external_credential_revocation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_iam_revocations",
        sa.Column("id", sa.Integer(), primary_key=True),
        # No users FK: pending cleanup must survive deletion of the UI user.
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("s3_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("iam_user_id", sa.String(), nullable=False),
        sa.Column("iam_username", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "user_id",
            "account_id",
            name="uq_portal_iam_revocations_user_account",
        ),
    )
    op.create_index(
        "ix_portal_iam_revocations_account",
        "portal_iam_revocations",
        ["account_id"],
    )
    op.create_index(
        "ix_portal_iam_revocations_user",
        "portal_iam_revocations",
        ["user_id"],
    )
    op.create_index(
        "ix_portal_iam_revocations_id",
        "portal_iam_revocations",
        ["id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text("SELECT 1 FROM portal_iam_revocations LIMIT 1")
    ).first() is not None:
        raise RuntimeError(
            "Complete pending Portal IAM user revocations before downgrading."
        )
    op.drop_index("ix_portal_iam_revocations_id", table_name="portal_iam_revocations")
    op.drop_index("ix_portal_iam_revocations_user", table_name="portal_iam_revocations")
    op.drop_index("ix_portal_iam_revocations_account", table_name="portal_iam_revocations")
    op.drop_table("portal_iam_revocations")
