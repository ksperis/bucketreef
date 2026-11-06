# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize persisted endpoint healthcheck statuses.

Revision ID: 0254_canonical_healthcheck_status
Revises: 0253_canonical_healthcheck_dimensions
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0254_canonical_healthcheck_status"
down_revision = "0253_canonical_healthcheck_dimensions"
branch_labels = None
depends_on = None


_VALID_STATUSES = ("up", "degraded", "down", "unknown")
_TABLE_CONSTRAINTS = {
    "endpoint_health_checks": "ck_endpoint_health_checks_status",
    "endpoint_health_latest": "ck_endpoint_health_latest_status",
    "endpoint_health_status_segments": "ck_endpoint_health_status_segments_status",
}


def _canonicalize_status(bind, table_name: str) -> None:
    bind.execute(
        sa.text(
            f"UPDATE {table_name} "
            "SET status = lower(trim(status)) "
            "WHERE status != lower(trim(status))"
        )
    )


def _unsupported_statuses(bind, table_name: str) -> list[str]:
    allowed = ", ".join(f"'{status}'" for status in _VALID_STATUSES)
    rows = bind.execute(
        sa.text(
            f"SELECT DISTINCT status FROM {table_name} "
            f"WHERE status NOT IN ({allowed}) ORDER BY status"
        )
    )
    return [str(row[0]) for row in rows]


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in _TABLE_CONSTRAINTS:
        _canonicalize_status(bind, table_name)
        unsupported = _unsupported_statuses(bind, table_name)
        if unsupported:
            raise RuntimeError(
                f"Unsupported healthcheck statuses in {table_name}: {unsupported}"
            )

    constraint = "status IN ('up', 'degraded', 'down', 'unknown')"
    for table_name, constraint_name in _TABLE_CONSTRAINTS.items():
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.create_check_constraint(constraint_name, constraint)


def downgrade() -> None:
    for table_name, constraint_name in reversed(tuple(_TABLE_CONSTRAINTS.items())):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_constraint(constraint_name, type_="check")
