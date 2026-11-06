# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted endpoint healthcheck modes.

Revision ID: 0252_canonical_healthcheck_mode
Revises: 0251_canonical_user_active_flag
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0252_canonical_healthcheck_mode"
down_revision = "0251_canonical_user_active_flag"
branch_labels = None
depends_on = None


_TABLE_CONSTRAINTS = {
    "endpoint_health_checks": "ck_endpoint_health_checks_mode",
    "endpoint_health_latest": "ck_endpoint_health_latest_mode",
    "endpoint_health_status_segments": "ck_endpoint_health_status_segments_mode",
    "endpoint_health_rollups": "ck_endpoint_health_rollups_mode",
}


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in _TABLE_CONSTRAINTS:
        bind.execute(
            sa.text(
                f"UPDATE {table_name} "
                "SET check_mode = CASE "
                "WHEN lower(trim(check_mode)) = 's3' THEN 's3' "
                "ELSE 'http' END "
                "WHERE check_mode NOT IN ('http', 's3')"
            )
        )

    for table_name, constraint_name in _TABLE_CONSTRAINTS.items():
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_check_constraint(
                constraint_name,
                "check_mode IN ('http', 's3')",
            )


def downgrade() -> None:
    for table_name, constraint_name in reversed(tuple(_TABLE_CONSTRAINTS.items())):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(constraint_name, type_="check")
