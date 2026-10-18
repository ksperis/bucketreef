"""Add billing entity groups and historized memberships."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0162_billing_entity_groups"
down_revision = "0161_billing_entities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "billing_entity_groups",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=True),
        sa.Column("external_id", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("name", name="uq_billing_entity_groups_name"),
        sa.UniqueConstraint("code", name="uq_billing_entity_groups_code"),
        sa.UniqueConstraint("external_id", name="uq_billing_entity_groups_external_id"),
    )
    op.create_index("ix_billing_entity_groups_id", "billing_entity_groups", ["id"])

    op.create_table(
        "billing_entity_group_memberships",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("billing_entity_group_id", sa.Integer(), nullable=False),
        sa.Column("billing_entity_id", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="ck_billing_entity_group_membership_period",
        ),
        sa.ForeignKeyConstraint(
            ["billing_entity_group_id"],
            ["billing_entity_groups.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["billing_entity_id"],
            ["billing_entities.id"],
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "billing_entity_group_id",
            "billing_entity_id",
            "effective_from",
            name="uq_billing_entity_group_membership_start",
        ),
    )
    op.create_index(
        "ix_billing_entity_group_memberships_id",
        "billing_entity_group_memberships",
        ["id"],
    )
    op.create_index(
        "ix_billing_entity_group_memberships_billing_entity_group_id",
        "billing_entity_group_memberships",
        ["billing_entity_group_id"],
    )
    op.create_index(
        "ix_billing_entity_group_memberships_billing_entity_id",
        "billing_entity_group_memberships",
        ["billing_entity_id"],
    )
    op.create_index(
        "ix_billing_entity_group_memberships_effective",
        "billing_entity_group_memberships",
        ["billing_entity_group_id", "billing_entity_id", "effective_from", "effective_to"],
    )


def downgrade() -> None:
    op.drop_table("billing_entity_group_memberships")
    op.drop_table("billing_entity_groups")
