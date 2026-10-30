# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store Cost measurement breakdowns as structured JSON.

Revision ID: 0218_structure_cost_measurement_breakdowns
Revises: 0217_structure_portal_settings_override
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0218_structure_cost_measurement_breakdowns"
down_revision = "0217_structure_portal_settings_override"
branch_labels = None
depends_on = None


legacy_usage = sa.table(
    "cost_usage_daily",
    sa.column("id", sa.Integer()),
    sa.column("ops_breakdown", sa.Text()),
    sa.column("ops_breakdown_structured", sa.JSON(none_as_null=True)),
)

structured_usage = sa.table(
    "cost_usage_daily",
    sa.column("id", sa.Integer()),
    sa.column("ops_breakdown", sa.JSON(none_as_null=True)),
    sa.column("ops_breakdown_text", sa.Text()),
)

legacy_storage = sa.table(
    "cost_storage_daily",
    sa.column("id", sa.Integer()),
    sa.column("by_bucket", sa.Text()),
    sa.column("by_bucket_structured", sa.JSON(none_as_null=True)),
)

structured_storage = sa.table(
    "cost_storage_daily",
    sa.column("id", sa.Integer()),
    sa.column("by_bucket", sa.JSON(none_as_null=True)),
    sa.column("by_bucket_text", sa.Text()),
)


def _load_json_object(*, row_label: str, field: str, raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError(f"{row_label} {field} must contain a JSON object.")
    try:
        value = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{row_label} {field} contains invalid JSON.") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{row_label} {field} must contain a JSON object.")
    return value or None


def _validate_ops_breakdown(row_id: int, value: object) -> dict[str, int] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or any(
        not isinstance(key, str)
        or not isinstance(count, int)
        or isinstance(count, bool)
        for key, count in value.items()
    ):
        raise ValueError(
            f"Cost usage row {row_id} ops_breakdown must map strings to integers."
        )
    return value or None


def _validate_by_bucket(
    row_id: int,
    value: object,
) -> dict[str, dict[str, int]] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(
            f"Cost storage row {row_id} by_bucket must map bucket names to usage objects."
        )
    for bucket_name, stats in value.items():
        if (
            not isinstance(bucket_name, str)
            or not isinstance(stats, dict)
            or set(stats) != {"used_bytes", "object_count"}
            or any(
                not isinstance(stats[field], int) or isinstance(stats[field], bool)
                for field in ("used_bytes", "object_count")
            )
        ):
            raise ValueError(
                f"Cost storage row {row_id} by_bucket must map bucket names to "
                "objects containing integer used_bytes and object_count values."
            )
    return value or None


def _load_ops_breakdown(row_id: int, raw: object) -> dict[str, int] | None:
    value = _load_json_object(
        row_label=f"Cost usage row {row_id}",
        field="ops_breakdown",
        raw=raw,
    )
    return _validate_ops_breakdown(row_id, value)


def _load_by_bucket(row_id: int, raw: object) -> dict[str, dict[str, int]] | None:
    value = _load_json_object(
        row_label=f"Cost storage row {row_id}",
        field="by_bucket",
        raw=raw,
    )
    return _validate_by_bucket(row_id, value)


def _dump_json(value: object) -> str | None:
    if value is None:
        return None
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )


def _dump_ops_breakdown(row_id: int, value: object) -> str | None:
    return _dump_json(_validate_ops_breakdown(row_id, value))


def _dump_by_bucket(row_id: int, value: object) -> str | None:
    return _dump_json(_validate_by_bucket(row_id, value))


def upgrade() -> None:
    op.add_column(
        "cost_usage_daily",
        sa.Column(
            "ops_breakdown_structured",
            sa.JSON(none_as_null=True),
            nullable=True,
        ),
    )
    op.add_column(
        "cost_storage_daily",
        sa.Column(
            "by_bucket_structured",
            sa.JSON(none_as_null=True),
            nullable=True,
        ),
    )
    bind = op.get_bind()
    usage_rows = bind.execute(
        sa.select(legacy_usage.c.id, legacy_usage.c.ops_breakdown)
    ).all()
    for row in usage_rows:
        bind.execute(
            legacy_usage.update()
            .where(legacy_usage.c.id == row.id)
            .values(ops_breakdown_structured=_load_ops_breakdown(row.id, row.ops_breakdown))
        )
    storage_rows = bind.execute(
        sa.select(legacy_storage.c.id, legacy_storage.c.by_bucket)
    ).all()
    for row in storage_rows:
        bind.execute(
            legacy_storage.update()
            .where(legacy_storage.c.id == row.id)
            .values(by_bucket_structured=_load_by_bucket(row.id, row.by_bucket))
        )
    with op.batch_alter_table("cost_usage_daily") as batch_op:
        batch_op.drop_column("ops_breakdown")
        batch_op.alter_column(
            "ops_breakdown_structured",
            existing_type=sa.JSON(none_as_null=True),
            new_column_name="ops_breakdown",
            nullable=True,
        )
    with op.batch_alter_table("cost_storage_daily") as batch_op:
        batch_op.drop_column("by_bucket")
        batch_op.alter_column(
            "by_bucket_structured",
            existing_type=sa.JSON(none_as_null=True),
            new_column_name="by_bucket",
            nullable=True,
        )


def downgrade() -> None:
    op.add_column(
        "cost_usage_daily",
        sa.Column("ops_breakdown_text", sa.Text(), nullable=True),
    )
    op.add_column(
        "cost_storage_daily",
        sa.Column("by_bucket_text", sa.Text(), nullable=True),
    )
    bind = op.get_bind()
    usage_rows = bind.execute(
        sa.select(structured_usage.c.id, structured_usage.c.ops_breakdown)
    ).all()
    for row in usage_rows:
        bind.execute(
            structured_usage.update()
            .where(structured_usage.c.id == row.id)
            .values(ops_breakdown_text=_dump_ops_breakdown(row.id, row.ops_breakdown))
        )
    storage_rows = bind.execute(
        sa.select(structured_storage.c.id, structured_storage.c.by_bucket)
    ).all()
    for row in storage_rows:
        bind.execute(
            structured_storage.update()
            .where(structured_storage.c.id == row.id)
            .values(by_bucket_text=_dump_by_bucket(row.id, row.by_bucket))
        )
    with op.batch_alter_table("cost_usage_daily") as batch_op:
        batch_op.drop_column("ops_breakdown")
        batch_op.alter_column(
            "ops_breakdown_text",
            existing_type=sa.Text(),
            new_column_name="ops_breakdown",
            nullable=True,
        )
    with op.batch_alter_table("cost_storage_daily") as batch_op:
        batch_op.drop_column("by_bucket")
        batch_op.alter_column(
            "by_bucket_text",
            existing_type=sa.Text(),
            new_column_name="by_bucket",
            nullable=True,
        )
