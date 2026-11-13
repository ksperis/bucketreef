# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add resource-level automatic Manager Browser access overrides.

Revision ID: 0274_manager_browser_resource_access
Revises: 0273_manager_browser_data_access_policy
Create Date: 2026-11-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0274_manager_browser_resource_access"
down_revision = "0273_manager_browser_data_access_policy"
branch_labels = None
depends_on = None


_COLUMN = "allow_manager_browser_data_access_for_all_admins"


def upgrade() -> None:
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column(_COLUMN, sa.Boolean(), nullable=True))
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column(_COLUMN, sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column(_COLUMN)
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column(_COLUMN)
