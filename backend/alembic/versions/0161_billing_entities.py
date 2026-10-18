"""Add billing entities and deterministic membership rules."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0161_billing_entities"
down_revision = "0160_billing_storage_quota_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_entities",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=True),
        sa.Column("external_id", sa.String(), nullable=True),
        sa.Column("subject_type", sa.String(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "subject_type IN ('account', 's3_user')",
            name="ck_billing_entities_subject_type",
        ),
        sa.UniqueConstraint("name", name="uq_billing_entities_name"),
        sa.UniqueConstraint("code", name="uq_billing_entities_code"),
        sa.UniqueConstraint("external_id", name="uq_billing_entities_external_id"),
    )
    op.create_index("ix_billing_entities_id", "billing_entities", ["id"])

    op.create_table(
        "billing_entity_tag_rules",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("billing_entity_id", sa.Integer(), nullable=False),
        sa.Column("tag_definition_id", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["billing_entity_id"],
            ["billing_entities.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["tag_definition_id"], ["tag_definitions.id"]),
        sa.UniqueConstraint(
            "billing_entity_id",
            "tag_definition_id",
            name="uq_billing_entity_tag_rule",
        ),
    )
    op.create_index(
        "ix_billing_entity_tag_rules_billing_entity_id",
        "billing_entity_tag_rules",
        ["billing_entity_id"],
    )
    op.create_index(
        "ix_billing_entity_tag_rules_tag",
        "billing_entity_tag_rules",
        ["tag_definition_id"],
    )

    op.create_table(
        "billing_entity_subject_rules",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("billing_entity_id", sa.Integer(), nullable=False),
        sa.Column("rule_type", sa.String(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "rule_type IN ('include', 'exclude')",
            name="ck_billing_entity_subject_rules_type",
        ),
        sa.CheckConstraint(
            "(s3_account_id IS NOT NULL AND s3_user_id IS NULL) OR "
            "(s3_account_id IS NULL AND s3_user_id IS NOT NULL)",
            name="ck_billing_entity_subject_rules_subject",
        ),
        sa.ForeignKeyConstraint(
            ["billing_entity_id"],
            ["billing_entities.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_billing_entity_subject_rules_billing_entity_id",
        "billing_entity_subject_rules",
        ["billing_entity_id"],
    )
    op.create_index(
        "ix_billing_entity_subject_rules_s3_account_id",
        "billing_entity_subject_rules",
        ["s3_account_id"],
    )
    op.create_index(
        "ix_billing_entity_subject_rules_s3_user_id",
        "billing_entity_subject_rules",
        ["s3_user_id"],
    )
    op.create_index(
        "uq_billing_entity_subject_rules_account",
        "billing_entity_subject_rules",
        ["billing_entity_id", "rule_type", "s3_account_id"],
        unique=True,
        sqlite_where=sa.text("s3_account_id IS NOT NULL"),
        postgresql_where=sa.text("s3_account_id IS NOT NULL"),
    )
    op.create_index(
        "uq_billing_entity_subject_rules_user",
        "billing_entity_subject_rules",
        ["billing_entity_id", "rule_type", "s3_user_id"],
        unique=True,
        sqlite_where=sa.text("s3_user_id IS NOT NULL"),
        postgresql_where=sa.text("s3_user_id IS NOT NULL"),
    )

    op.create_table(
        "billing_entity_rate_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("billing_entity_id", sa.Integer(), nullable=False),
        sa.Column("rate_plan_id", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["billing_entity_id"],
            ["billing_entities.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["rate_plan_id"], ["billing_rate_plans.id"]),
        sa.UniqueConstraint(
            "billing_entity_id",
            "effective_from",
            name="uq_billing_entity_rate_assignment_start",
        ),
    )
    op.create_index(
        "ix_billing_entity_rate_assignments_id",
        "billing_entity_rate_assignments",
        ["id"],
    )
    op.create_index(
        "ix_billing_entity_rate_assignments_billing_entity_id",
        "billing_entity_rate_assignments",
        ["billing_entity_id"],
    )
    op.create_index(
        "ix_billing_entity_rate_assignments_rate_plan_id",
        "billing_entity_rate_assignments",
        ["rate_plan_id"],
    )
    op.create_index(
        "ix_billing_entity_rate_assignments_effective",
        "billing_entity_rate_assignments",
        ["billing_entity_id", "effective_from", "effective_to"],
    )


def downgrade() -> None:
    op.drop_table("billing_entity_rate_assignments")
    op.drop_table("billing_entity_subject_rules")
    op.drop_table("billing_entity_tag_rules")
    op.drop_table("billing_entities")
