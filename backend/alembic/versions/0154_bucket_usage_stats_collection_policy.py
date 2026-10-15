# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Add per-account bucket usage statistics collection override."""

import sqlalchemy as sa
from alembic import op

revision = "0154_bucket_usage_stats_collection_policy"
down_revision = "0153_rgw_tenant_default_compat"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("allow_bucket_usage_stats_collection", sa.Boolean(), nullable=True))


def downgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("allow_bucket_usage_stats_collection")
