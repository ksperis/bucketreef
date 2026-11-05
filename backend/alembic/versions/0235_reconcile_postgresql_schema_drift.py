# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Reconcile PostgreSQL schema drift with current metadata.

Revision ID: 0235_reconcile_postgresql_schema_drift
Revises: 0234_remove_first_admin_created_user_id
Create Date: 2026-11-04
"""

from collections.abc import Iterable

from alembic import op
import sqlalchemy as sa


revision = "0235_reconcile_postgresql_schema_drift"
down_revision = "0234_remove_first_admin_created_user_id"
branch_labels = None
depends_on = None


_COST_UTC_COLUMNS: dict[str, tuple[str, ...]] = {
    "cost_usage_daily": ("collected_at",),
    "cost_storage_daily": ("collected_at",),
    "cost_models": ("created_at", "updated_at"),
    "cost_endpoint_overrides": ("created_at", "updated_at"),
}


def _quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _postgresql_timestamp_statements(*, timezone_aware: bool) -> Iterable[str]:
    target = "TIMESTAMP WITH TIME ZONE" if timezone_aware else "TIMESTAMP WITHOUT TIME ZONE"
    for table_name, column_names in _COST_UTC_COLUMNS.items():
        for column_name in column_names:
            table = _quoted(table_name)
            column = _quoted(column_name)
            yield (
                f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {target} "
                f"USING {column} AT TIME ZONE 'UTC'"
            )


def _refresh_token_hash_unique_constraint(bind: sa.Connection) -> str | None:
    for constraint in sa.inspect(bind).get_unique_constraints("refresh_tokens"):
        if constraint.get("column_names") == ["token_hash"]:
            name = constraint.get("name")
            if name:
                return str(name)
    return None


def _require_supported_dialect(dialect: str) -> None:
    if dialect not in {"postgresql", "sqlite"}:
        raise RuntimeError(f"Unsupported database dialect for schema reconciliation: {dialect}")


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    _require_supported_dialect(dialect)
    if dialect != "postgresql":
        return

    for statement in _postgresql_timestamp_statements(timezone_aware=True):
        op.execute(sa.text(statement))

    constraint_name = _refresh_token_hash_unique_constraint(bind)
    if constraint_name:
        op.drop_constraint(
            constraint_name,
            "refresh_tokens",
            type_="unique",
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    _require_supported_dialect(dialect)
    if dialect != "postgresql":
        return

    op.create_unique_constraint(
        "uq_refresh_tokens_token_hash",
        "refresh_tokens",
        ["token_hash"],
    )
    for statement in _postgresql_timestamp_statements(timezone_aware=False):
        op.execute(sa.text(statement))
