# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Merge the rejoined GitHub and GitLab migration histories.

The revision ID is retained because this migration was already published on
``main`` during the refusion. The PostgreSQL reconciliation itself remains on
its original GitLab revision so databases stamped with either history can
reach this merge head without replaying the data conversion.

Revision ID: 0235_reconcile_postgresql_schema_drift
Revises: 0234_remove_first_admin_created_user_id, 0226_reconcile_postgresql_schema_drift
Create Date: 2026-11-04
"""

revision = "0235_reconcile_postgresql_schema_drift"
down_revision = (
    "0234_remove_first_admin_created_user_id",
    "0226_reconcile_postgresql_schema_drift",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
