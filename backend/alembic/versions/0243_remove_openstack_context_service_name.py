# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused persisted OpenStack service name.

Revision ID: 0243_remove_context_service_name
Revises: 0242_remove_latest_sample_count
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0243_remove_context_service_name"
down_revision = "0242_remove_latest_sample_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.drop_column("service_name")


def downgrade() -> None:
    with op.batch_alter_table("openstack_project_contexts") as batch:
        batch.add_column(sa.Column("service_name", sa.String(), nullable=True))
