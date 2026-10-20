"""Add targeted Cost estimation overrides for Manager subjects.

Revision ID: 0170_cost_estimation_policies
Revises: 0169_cost_model
Create Date: 2026-10-20 10:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0170_cost_estimation_policies"
down_revision = "0169_cost_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("allow_cost_estimation", sa.Boolean(), nullable=True))
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("allow_cost_estimation", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("allow_cost_estimation")
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("allow_cost_estimation")
