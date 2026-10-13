# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Add the nullable RGW Account override for Manager activity history."""

import sqlalchemy as sa
from alembic import op

revision = "0149_manager_activity_history"
down_revision = "0148_feature_policies"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("allow_activity_history", sa.Boolean(), nullable=True))


def downgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("allow_activity_history")
