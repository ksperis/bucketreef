# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Cascade derived cost and quota rows with their owning resource.

Revision ID: 0266_cost_quota_resource_cascades
Revises: 0265_user_notification_subject_foreign_keys
Create Date: 2026-11-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0266_cost_quota_resource_cascades"
down_revision = "0265_user_notification_subject_foreign_keys"
branch_labels = None
depends_on = None


_TABLES = (
    "cost_usage_daily",
    "cost_storage_daily",
    "quota_usage_hourly",
    "quota_usage_daily",
    "quota_alert_states",
)
_REFERENCES = (
    ("storage_endpoint_id", "storage_endpoints"),
    ("s3_account_id", "s3_accounts"),
    ("s3_user_id", "s3_users"),
)
_SQLITE_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _replace_resource_foreign_keys(
    table_name: str,
    *,
    ondelete: str | None,
) -> None:
    bind = op.get_bind()
    foreign_keys = sa.inspect(bind).get_foreign_keys(table_name)
    replacements: list[tuple[str, str, str]] = []
    use_sqlite_naming_convention = False

    for column_name, referred_table in _REFERENCES:
        foreign_key = next(
            (
                item
                for item in foreign_keys
                if item.get("constrained_columns") == [column_name]
            ),
            None,
        )
        if foreign_key is None:
            raise RuntimeError(f"Cannot locate {table_name}.{column_name} foreign key")

        constraint_name = foreign_key.get("name")
        if bind.dialect.name == "sqlite" and not constraint_name:
            use_sqlite_naming_convention = True
            constraint_name = f"fk_{table_name}_{column_name}_{referred_table}"
        if not constraint_name:
            raise RuntimeError(f"Cannot identify {table_name}.{column_name} foreign key")
        replacements.append((column_name, referred_table, str(constraint_name)))

    batch_kwargs: dict[str, object] = {"schema": None}
    if use_sqlite_naming_convention:
        batch_kwargs["naming_convention"] = _SQLITE_NAMING_CONVENTION

    with op.batch_alter_table(table_name, **batch_kwargs) as batch_op:
        for column_name, referred_table, constraint_name in replacements:
            batch_op.drop_constraint(constraint_name, type_="foreignkey")
            batch_op.create_foreign_key(
                f"fk_{table_name}_{column_name}_{referred_table}",
                referred_table,
                [column_name],
                ["id"],
                ondelete=ondelete,
            )


def upgrade() -> None:
    for table_name in _TABLES:
        _replace_resource_foreign_keys(table_name, ondelete="CASCADE")


def downgrade() -> None:
    for table_name in _TABLES:
        _replace_resource_foreign_keys(table_name, ondelete=None)
