# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store bucket migration workflow state as structured JSON.

Revision ID: 0213_structure_bucket_migration_json
Revises: 0212_structure_user_ui_preferences
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0213_structure_bucket_migration_json"
down_revision = "0212_structure_user_ui_preferences"
branch_labels = None
depends_on = None


MIGRATION_FIELDS = (("precheck_report_json", "precheck_report"),)
ITEM_FIELDS = (
    ("preparation_effects_json", "preparation_effects"),
    ("cleanup_verification_json", "cleanup_verification"),
    ("diff_sample_json", "diff_sample"),
    ("source_snapshot_json", "source_snapshot"),
    ("target_snapshot_json", "target_snapshot"),
    ("replication_state_json", "replication_state"),
    ("source_policy_backup_json", "source_policy_backup"),
    ("target_policy_backup_json", "target_policy_backup"),
)
EVENT_FIELDS = (("metadata_json", "metadata"),)


def _table(name: str, fields: tuple[tuple[str, str], ...]) -> sa.TableClause:
    columns: list[sa.ColumnClause[Any]] = [sa.column("id", sa.Integer())]
    for legacy_name, structured_name in fields:
        columns.extend(
            (
                sa.column(legacy_name, sa.Text()),
                sa.column(structured_name, sa.JSON(none_as_null=True)),
            )
        )
    return sa.table(name, *columns)


bucket_migrations = _table("bucket_migrations", MIGRATION_FIELDS)
bucket_migration_items = _table("bucket_migration_items", ITEM_FIELDS)
bucket_migration_events = _table("bucket_migration_events", EVENT_FIELDS)


def _load_object(table_name: str, row_id: int, field_name: str, raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError(
            f"{table_name} row {row_id} {field_name} must contain a JSON object."
        )
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"{table_name} row {row_id} {field_name} contains invalid JSON."
        ) from exc
    if not isinstance(payload, dict):
        raise ValueError(
            f"{table_name} row {row_id} {field_name} must contain a JSON object."
        )
    return payload


def _upgrade_table(
    table: sa.TableClause,
    fields: tuple[tuple[str, str], ...],
) -> None:
    table_name = table.name
    for _legacy_name, structured_name in fields:
        op.add_column(
            table_name,
            sa.Column(structured_name, sa.JSON(none_as_null=True), nullable=True),
        )

    bind = op.get_bind()
    selected = [table.c.id]
    selected.extend(table.c[legacy_name] for legacy_name, _ in fields)
    for row in bind.execute(sa.select(*selected)).mappings():
        values = {
            structured_name: _load_object(
                table_name,
                row["id"],
                legacy_name,
                row[legacy_name],
            )
            for legacy_name, structured_name in fields
        }
        bind.execute(table.update().where(table.c.id == row["id"]).values(**values))

    with op.batch_alter_table(table_name) as batch_op:
        for legacy_name, _structured_name in fields:
            batch_op.drop_column(legacy_name)


def _dump_object(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("Structured bucket migration JSON must contain an object.")
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def _downgrade_table(
    table: sa.TableClause,
    fields: tuple[tuple[str, str], ...],
) -> None:
    table_name = table.name
    with op.batch_alter_table(table_name) as batch_op:
        for legacy_name, _structured_name in fields:
            batch_op.add_column(sa.Column(legacy_name, sa.Text(), nullable=True))

    bind = op.get_bind()
    selected = [table.c.id]
    selected.extend(table.c[structured_name] for _, structured_name in fields)
    for row in bind.execute(sa.select(*selected)).mappings():
        values = {
            legacy_name: _dump_object(row[structured_name])
            for legacy_name, structured_name in fields
        }
        bind.execute(table.update().where(table.c.id == row["id"]).values(**values))

    with op.batch_alter_table(table_name) as batch_op:
        for _legacy_name, structured_name in fields:
            batch_op.drop_column(structured_name)


def upgrade() -> None:
    _upgrade_table(bucket_migrations, MIGRATION_FIELDS)
    _upgrade_table(bucket_migration_items, ITEM_FIELDS)
    _upgrade_table(bucket_migration_events, EVENT_FIELDS)


def downgrade() -> None:
    _downgrade_table(bucket_migration_events, EVENT_FIELDS)
    _downgrade_table(bucket_migration_items, ITEM_FIELDS)
    _downgrade_table(bucket_migrations, MIGRATION_FIELDS)
