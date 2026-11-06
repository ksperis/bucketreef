# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted endpoint healthcheck dimensions.

Revision ID: 0253_canonical_healthcheck_dimensions
Revises: 0252_canonical_healthcheck_mode
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0253_canonical_healthcheck_dimensions"
down_revision = "0252_canonical_healthcheck_mode"
branch_labels = None
depends_on = None


_TABLE_CONSTRAINTS = {
    "endpoint_health_latest": "ck_endpoint_health_latest_dimensions",
    "endpoint_health_status_segments": "ck_endpoint_health_status_segments_dimensions",
    "endpoint_health_rollups": "ck_endpoint_health_rollups_dimensions",
}


def _canonicalize_dimension(bind, table_name: str, column_name: str) -> None:
    bind.execute(
        sa.text(
            f"UPDATE {table_name} "
            f"SET {column_name} = lower(trim({column_name})) "
            f"WHERE {column_name} != lower(trim({column_name}))"
        )
    )


def _unsupported_values(bind, table_name: str, column_name: str, expected: str) -> list[str]:
    rows = bind.execute(
        sa.text(
            f"SELECT DISTINCT {column_name} FROM {table_name} "
            f"WHERE {column_name} != :expected ORDER BY {column_name}"
        ),
        {"expected": expected},
    )
    return [str(row[0]) for row in rows]


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in _TABLE_CONSTRAINTS:
        _canonicalize_dimension(bind, table_name, "check_type")
        _canonicalize_dimension(bind, table_name, "scope")
        unsupported_types = _unsupported_values(
            bind,
            table_name,
            "check_type",
            "availability",
        )
        unsupported_scopes = _unsupported_values(
            bind,
            table_name,
            "scope",
            "endpoint",
        )
        if unsupported_types or unsupported_scopes:
            raise RuntimeError(
                f"Unsupported healthcheck dimensions in {table_name}: "
                f"check_type={unsupported_types}, scope={unsupported_scopes}"
            )

    for table_name, constraint_name in _TABLE_CONSTRAINTS.items():
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_check_constraint(
                constraint_name,
                "check_type = 'availability' AND scope = 'endpoint'",
            )


def downgrade() -> None:
    for table_name, constraint_name in reversed(tuple(_TABLE_CONSTRAINTS.items())):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(constraint_name, type_="check")
