# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store bucket usage statistics payloads as structured JSON.

Revision ID: 0207_structure_bucket_usage_stats_payloads
Revises: 0206_structure_onboarding_journey_payloads
Create Date: 2026-10-30
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0207_structure_bucket_usage_stats_payloads"
down_revision = "0206_structure_onboarding_journey_payloads"
branch_labels = None
depends_on = None


DISTRIBUTIONS = (
    ("data_type_distribution_json", "data_type_distribution"),
    ("storage_class_distribution_json", "storage_class_distribution"),
    ("size_distribution_json", "size_distribution"),
    ("age_distribution_json", "age_distribution"),
    ("current_noncurrent_distribution_json", "current_noncurrent_distribution"),
)


bucket_usage_stats = sa.table(
    "bucket_usage_stats_snapshots",
    sa.column("id", sa.Integer()),
    *[sa.column(old, sa.Text()) for old, _new in DISTRIBUTIONS],
    *[sa.column(new, sa.JSON()) for _old, new in DISTRIBUTIONS],
    sa.column("warnings_json", sa.Text()),
    sa.column("warnings", sa.JSON()),
)


def _load_distribution(row_id: int, field: str, raw: object) -> list[dict[str, Any]]:
    if not isinstance(raw, str):
        raise ValueError(f"Bucket usage snapshot {row_id} {field} must contain a JSON list.")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Bucket usage snapshot {row_id} {field} contains invalid JSON.") from exc
    if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
        raise ValueError(f"Bucket usage snapshot {row_id} {field} must contain a JSON object list.")
    return payload


def _load_warnings(row_id: int, raw: object) -> list[str] | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ValueError(f"Bucket usage snapshot {row_id} warnings_json must contain a JSON list.")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Bucket usage snapshot {row_id} warnings_json contains invalid JSON.") from exc
    if not isinstance(payload, list) or any(not isinstance(item, str) for item in payload):
        raise ValueError(f"Bucket usage snapshot {row_id} warnings_json must contain a JSON string list.")
    return payload


def upgrade() -> None:
    for _old, new in DISTRIBUTIONS:
        op.add_column("bucket_usage_stats_snapshots", sa.Column(new, sa.JSON(), nullable=True))
    op.add_column("bucket_usage_stats_snapshots", sa.Column("warnings", sa.JSON(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.select(bucket_usage_stats)).all()
    for row in rows:
        values = {
            new: _load_distribution(row.id, old, getattr(row, old))
            for old, new in DISTRIBUTIONS
        }
        values["warnings"] = _load_warnings(row.id, row.warnings_json)
        bind.execute(
            bucket_usage_stats.update()
            .where(bucket_usage_stats.c.id == row.id)
            .values(**values)
        )

    with op.batch_alter_table("bucket_usage_stats_snapshots") as batch_op:
        for old, new in DISTRIBUTIONS:
            batch_op.alter_column(new, existing_type=sa.JSON(), nullable=False)
            batch_op.drop_column(old)
        batch_op.drop_column("warnings_json")


def downgrade() -> None:
    with op.batch_alter_table("bucket_usage_stats_snapshots") as batch_op:
        for old, _new in DISTRIBUTIONS:
            batch_op.add_column(sa.Column(old, sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("warnings_json", sa.Text(), nullable=True))

    bind = op.get_bind()
    rows = bind.execute(sa.select(bucket_usage_stats)).all()
    for row in rows:
        values = {
            old: json.dumps(
                getattr(row, new),
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            )
            for old, new in DISTRIBUTIONS
        }
        values["warnings_json"] = (
            json.dumps(row.warnings, ensure_ascii=True, separators=(",", ":"))
            if row.warnings is not None
            else None
        )
        bind.execute(
            bucket_usage_stats.update()
            .where(bucket_usage_stats.c.id == row.id)
            .values(**values)
        )

    with op.batch_alter_table("bucket_usage_stats_snapshots") as batch_op:
        for old, _new in DISTRIBUTIONS:
            batch_op.alter_column(old, existing_type=sa.Text(), nullable=False)
        for _old, new in DISTRIBUTIONS:
            batch_op.drop_column(new)
        batch_op.drop_column("warnings")
