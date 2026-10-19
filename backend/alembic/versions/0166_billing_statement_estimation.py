"""Add auditable Billing Statement estimation mode."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0166_billing_statement_estimation"
down_revision = "0165_scope_s3_account_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("billing_statements", schema=None) as batch:
        batch.add_column(
            sa.Column(
                "estimation_mode",
                sa.String(),
                nullable=False,
                server_default="strict",
            )
        )
        batch.add_column(sa.Column("estimation_reason", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("estimation_requested_by_email", sa.String(), nullable=True)
        )
        batch.create_check_constraint(
            "ck_billing_statements_estimation_mode",
            "estimation_mode IN ('strict', 'coverage_extrapolation')",
        )


def downgrade() -> None:
    with op.batch_alter_table("billing_statements", schema=None) as batch:
        batch.drop_constraint(
            "ck_billing_statements_estimation_mode",
            type_="check",
        )
        batch.drop_column("estimation_requested_by_email")
        batch.drop_column("estimation_reason")
        batch.drop_column("estimation_mode")
