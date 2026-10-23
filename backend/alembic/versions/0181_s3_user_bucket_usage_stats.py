"""Add bucket usage statistics overrides to S3 users.

Revision ID: 0181_s3_user_bucket_usage_stats
Revises: 0180_bucket_usage_stats_tenant_identity
Create Date: 2026-10-23 15:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0181_s3_user_bucket_usage_stats"
down_revision = "0180_bucket_usage_stats_tenant_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("allow_bucket_usage_stats", sa.Boolean(), nullable=True))
        batch.add_column(
            sa.Column("allow_bucket_usage_stats_collection", sa.Boolean(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("allow_bucket_usage_stats_collection")
        batch.drop_column("allow_bucket_usage_stats")
