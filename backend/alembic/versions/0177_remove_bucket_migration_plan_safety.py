# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove duplicated safety fields from bucket migration execution plans.

Revision ID: 0177_remove_bucket_migration_plan_safety
Revises: 0176_remove_bucket_migration_plan_blocked
Create Date: 2026-10-20 19:30:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0177_remove_bucket_migration_plan_safety"
down_revision = "0176_remove_bucket_migration_plan_blocked"
branch_labels = None
depends_on = None

_SAFETY_FIELDS = (
    "delete_source_safe",
    "rollback_safe",
    "same_endpoint_copy_safe",
)


def _report_item_safety(raw: str | None, *, item_id: int) -> dict[str, bool]:
    if raw is None:
        return {}
    try:
        report = json.loads(raw)
    except ValueError:
        return {}
    if not isinstance(report, dict):
        return {}
    items = report.get("items")
    if not isinstance(items, list):
        return {}

    for item in items:
        if not isinstance(item, dict) or item.get("item_id") != item_id:
            continue
        return {
            field: item[field]
            for field in _SAFETY_FIELDS
            if isinstance(item.get(field), bool)
        }
    return {}


def _rewrite_plan(
    raw: str | None,
    *,
    restore_safety: dict[str, bool] | None,
) -> str | None:
    if raw is None:
        return None
    try:
        plan = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(plan, dict):
        return raw

    changed = False
    if restore_safety is None:
        for field in _SAFETY_FIELDS:
            if field in plan:
                plan.pop(field, None)
                changed = True
    else:
        for field, value in restore_safety.items():
            if field not in plan:
                plan[field] = value
                changed = True

    if not changed:
        return raw
    return json.dumps(plan, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, restore_safety: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT i.id, i.execution_plan_json, m.precheck_report_json "
            "FROM bucket_migration_items AS i "
            "JOIN bucket_migrations AS m ON m.id = i.migration_id"
        )
    ).mappings()
    for row in rows:
        safety = (
            _report_item_safety(
                row["precheck_report_json"],
                item_id=row["id"],
            )
            if restore_safety
            else None
        )
        rewritten = _rewrite_plan(
            row["execution_plan_json"],
            restore_safety=safety,
        )
        if rewritten == row["execution_plan_json"]:
            continue
        bind.execute(
            sa.text(
                "UPDATE bucket_migration_items "
                "SET execution_plan_json = :plan WHERE id = :id"
            ),
            {"id": row["id"], "plan": rewritten},
        )


def upgrade() -> None:
    _rewrite_all(restore_safety=False)


def downgrade() -> None:
    _rewrite_all(restore_safety=True)
