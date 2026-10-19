"""Add immutable monthly billing statements and snapshot lines."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0163_billing_statements"
down_revision = "0162_billing_entity_groups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_statements",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("public_id", sa.String(length=36), nullable=False),
        sa.Column("billing_entity_id", sa.Integer(), nullable=False),
        sa.Column("billing_entity_name", sa.String(), nullable=False),
        sa.Column("billing_entity_code", sa.String(), nullable=True),
        sa.Column("billing_entity_external_id", sa.String(), nullable=True),
        sa.Column("subject_type", sa.String(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("member_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("coverage_json", sa.Text(), nullable=False),
        sa.Column("blockers_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("storage_charge_bases_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("subtotal", sa.Numeric(24, 6), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(24, 6), nullable=False, server_default="0"),
        sa.Column("source_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("generated_at", UTCDateTime(), nullable=False),
        sa.Column("finalized_at", UTCDateTime(), nullable=True),
        sa.Column("finalized_by_user_id", sa.Integer(), nullable=True),
        sa.Column("finalized_by_user_email", sa.String(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'finalized')", name="ck_billing_statements_status"),
        sa.CheckConstraint(
            "subject_type IN ('account', 's3_user')",
            name="ck_billing_statements_subject_type",
        ),
        sa.CheckConstraint("period_end >= period_start", name="ck_billing_statements_period"),
        sa.ForeignKeyConstraint(["billing_entity_id"], ["billing_entities.id"]),
        sa.ForeignKeyConstraint(["finalized_by_user_id"], ["users.id"]),
        sa.UniqueConstraint(
            "billing_entity_id",
            "period_start",
            "currency",
            name="uq_billing_statements_entity_period_currency",
        ),
    )
    op.create_index("ix_billing_statements_id", "billing_statements", ["id"])
    op.create_index("ix_billing_statements_public_id", "billing_statements", ["public_id"], unique=True)
    op.create_index("ix_billing_statements_billing_entity_id", "billing_statements", ["billing_entity_id"])
    op.create_index("ix_billing_statements_period_start", "billing_statements", ["period_start"])
    op.create_index(
        "ix_billing_statements_period_status",
        "billing_statements",
        ["period_start", "status"],
    )

    op.create_table(
        "billing_statement_lines",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("billing_statement_id", sa.Integer(), nullable=False),
        sa.Column("line_index", sa.Integer(), nullable=False),
        sa.Column("subject_type", sa.String(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("subject_name", sa.String(), nullable=False),
        sa.Column("rgw_identifier", sa.String(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_name", sa.String(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("storage_charge_basis", sa.String(), nullable=True),
        sa.Column("total_cost", sa.Numeric(24, 6), nullable=True),
        sa.Column("complete", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "subject_type IN ('account', 's3_user')",
            name="ck_billing_statement_lines_subject_type",
        ),
        sa.CheckConstraint(
            "storage_charge_basis IS NULL OR storage_charge_basis IN ('actual_usage', 'allocated_quota')",
            name="ck_billing_statement_lines_storage_charge_basis",
        ),
        sa.ForeignKeyConstraint(
            ["billing_statement_id"],
            ["billing_statements.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "billing_statement_id",
            "line_index",
            name="uq_billing_statement_lines_position",
        ),
    )
    op.create_index("ix_billing_statement_lines_id", "billing_statement_lines", ["id"])
    op.create_index(
        "ix_billing_statement_lines_billing_statement_id",
        "billing_statement_lines",
        ["billing_statement_id"],
    )
    op.create_index(
        "ix_billing_statement_lines_subject",
        "billing_statement_lines",
        ["subject_type", "subject_id"],
    )
    op.create_index(
        "ix_billing_statement_lines_endpoint",
        "billing_statement_lines",
        ["storage_endpoint_id"],
    )


def downgrade() -> None:
    op.drop_table("billing_statement_lines")
    op.drop_table("billing_statements")
