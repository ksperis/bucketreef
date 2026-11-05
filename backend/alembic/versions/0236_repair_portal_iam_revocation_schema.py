# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Repair missing Portal IAM revocation table after rejoined history.

Revision ID: 0236_repair_portal_iam_revocation_schema
Revises: 0235_reconcile_postgresql_schema_drift
Create Date: 2026-11-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0236_repair_portal_iam_revocation_schema"
down_revision = "0235_reconcile_postgresql_schema_drift"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "portal_iam_revocations" in sa.inspect(bind).get_table_names():
        return

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
    # Forward-only repair. Revision 0227 already made this table part of the
    # canonical schema, and databases that traversed that branch owned it
    # before this repair revision existed.
    pass
