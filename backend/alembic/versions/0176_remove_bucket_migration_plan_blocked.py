# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove redundant bucket migration execution-plan blocked flag.

Revision ID: 0176_remove_bucket_migration_plan_blocked
Revises: 0175_remove_bucket_migration_report_version
Create Date: 2026-10-20 19:15:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0176_remove_bucket_migration_plan_blocked"
down_revision = "0175_remove_bucket_migration_report_version"
branch_labels = None
depends_on = None


def _rewrite_plan(raw: str | None, *, restore_blocked: bool) -> str | None:
    if raw is None:
        return None
    try:
        plan = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(plan, dict):
        return raw

    if restore_blocked:
        if "blocked" in plan or "supported" not in plan:
            return raw
        plan["blocked"] = not bool(plan["supported"])
    else:
        if "blocked" not in plan:
            return raw
        plan.pop("blocked", None)

    return json.dumps(plan, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, restore_blocked: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, execution_plan_json FROM bucket_migration_items")
    ).mappings()
    for row in rows:
        rewritten = _rewrite_plan(
            row["execution_plan_json"],
            restore_blocked=restore_blocked,
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
    _rewrite_all(restore_blocked=False)


def downgrade() -> None:
    _rewrite_all(restore_blocked=True)
