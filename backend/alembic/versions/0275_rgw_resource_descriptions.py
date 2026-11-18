# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add local descriptions to RGW accounts and users.

Revision ID: 0275_rgw_resource_descriptions
Revises: 0274_manager_browser_resource_access
Create Date: 2026-11-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0275_rgw_resource_descriptions"
down_revision = "0274_manager_browser_resource_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("description", sa.String(length=2000), nullable=True))
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("description", sa.String(length=2000), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("description")
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("description")
