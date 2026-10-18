"""Add durable Billing statement automation run history."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0164_billing_statement_automation"
down_revision = "0163_billing_statements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_automation_runs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("trigger_source", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="running"),
        sa.Column("active_entity_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_statement_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("finalized_statement_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("blocked_statement_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_entity_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unassigned_subject_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("diagnostics_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("started_at", UTCDateTime(), nullable=False),
        sa.Column("completed_at", UTCDateTime(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "mode IN ('automatic_draft', 'automatic_finalize')",
            name="ck_billing_automation_runs_mode",
        ),
        sa.CheckConstraint(
            "trigger_source IN ('scheduled', 'retry')",
            name="ck_billing_automation_runs_trigger_source",
        ),
        sa.CheckConstraint(
            "status IN ('running', 'completed', 'partial', 'failed')",
            name="ck_billing_automation_runs_status",
        ),
    )
    op.create_index("ix_billing_automation_runs_id", "billing_automation_runs", ["id"])
    op.create_index("ix_billing_automation_runs_period_start", "billing_automation_runs", ["period_start"])
    op.create_index(
        "ix_billing_automation_runs_period_started",
        "billing_automation_runs",
        ["period_start", "started_at"],
    )


def downgrade() -> None:
    op.drop_table("billing_automation_runs")
