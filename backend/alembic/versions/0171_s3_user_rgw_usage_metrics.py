"""Add RGW usage metrics override to S3 users.

Revision ID: 0171_s3_user_rgw_usage_metrics
Revises: 0170_cost_estimation_policies
Create Date: 2026-10-20 12:45:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0171_s3_user_rgw_usage_metrics"
down_revision = "0170_cost_estimation_policies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("allow_rgw_usage_metrics", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("allow_rgw_usage_metrics")
