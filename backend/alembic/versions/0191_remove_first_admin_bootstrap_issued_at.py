# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused first-admin bootstrap issuance timestamp.

Revision ID: 0191_remove_first_admin_bootstrap_issued_at
Revises: 0190_remove_operation_lease_acquired_at
Create Date: 2026-10-24 18:05:00.000000
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0191_remove_first_admin_bootstrap_issued_at"
down_revision = "0190_remove_operation_lease_acquired_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("first_admin_bootstrap") as batch:
        batch.drop_column("issued_at")


def downgrade() -> None:
    with op.batch_alter_table("first_admin_bootstrap") as batch:
        batch.add_column(sa.Column("issued_at", UTCDateTime(), nullable=True))
