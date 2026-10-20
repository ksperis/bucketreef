# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize bucket migration execution-plan strategies.

Revision ID: 0178_canonical_bucket_migration_plan_strategy
Revises: 0177_remove_bucket_migration_plan_safety
Create Date: 2026-10-20 19:45:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0178_canonical_bucket_migration_plan_strategy"
down_revision = "0177_remove_bucket_migration_plan_safety"
branch_labels = None
depends_on = None


def _rewrite_plan(raw: str | None) -> str | None:
    if raw is None:
        return None
    try:
        plan = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(plan, dict):
        return raw

    strategy = plan.get("strategy")
    if strategy is None:
        plan["strategy"] = "current_only"
    elif isinstance(strategy, str):
        canonical = strategy.strip()
        if not canonical:
            canonical = "current_only"
        if canonical == strategy:
            return raw
        plan["strategy"] = canonical
    else:
        return raw

    return json.dumps(plan, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT i.id, i.execution_plan_json "
            "FROM bucket_migration_items AS i "
            "JOIN bucket_migrations AS m ON m.id = i.migration_id "
            "WHERE m.workflow_version = 2 AND i.execution_plan_json IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        rewritten = _rewrite_plan(row["execution_plan_json"])
        if rewritten == row["execution_plan_json"]:
            continue
        bind.execute(
            sa.text(
                "UPDATE bucket_migration_items "
                "SET execution_plan_json = :plan WHERE id = :id"
            ),
            {"id": row["id"], "plan": rewritten},
        )


def downgrade() -> None:
    # Explicit canonical strategies are accepted by the previous runtime too.
    pass
