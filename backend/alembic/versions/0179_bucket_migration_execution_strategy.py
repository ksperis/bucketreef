# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Replace bucket migration execution-plan JSON with a strategy column.

Revision ID: 0179_bucket_migration_execution_strategy
Revises: 0178_canonical_bucket_migration_plan_strategy
Create Date: 2026-10-20 20:00:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0179_bucket_migration_execution_strategy"
down_revision = "0178_canonical_bucket_migration_plan_strategy"
branch_labels = None
depends_on = None


def _strategy_from_plan(raw: str | None) -> str | None:
    if raw is None:
        return None
    try:
        plan = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(plan, dict):
        return None
    strategy = plan.get("strategy")
    return strategy if isinstance(strategy, str) and strategy else None


def _legacy_plan(
    strategy: str,
    *,
    item_id: int,
    precheck_status: str | None,
    precheck_report_json: str | None,
) -> str:
    supported = precheck_status == "passed"
    blocking_codes: list[str] = []
    try:
        report = json.loads(precheck_report_json) if precheck_report_json else None
    except ValueError:
        report = None
    if isinstance(report, dict):
        items = report.get("items")
        if isinstance(items, list):
            for entry in items:
                if not isinstance(entry, dict) or entry.get("item_id") != item_id:
                    continue
                blocking = entry.get("blocking")
                if isinstance(blocking, bool):
                    supported = not blocking
                checks = entry.get("checks")
                if isinstance(checks, list):
                    blocking_codes = [
                        str(check["code"])
                        for check in checks
                        if isinstance(check, dict)
                        and bool(check.get("blocking"))
                        and check.get("code") is not None
                    ]
                break
    return json.dumps(
        {
            "strategy": strategy,
            "supported": supported,
            "blocking_codes": blocking_codes,
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.add_column(sa.Column("execution_strategy", sa.String(), nullable=True))

    rows = bind.execute(
        sa.text(
            "SELECT id, execution_plan_json FROM bucket_migration_items "
            "WHERE execution_plan_json IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        strategy = _strategy_from_plan(row["execution_plan_json"])
        if strategy is None:
            continue
        bind.execute(
            sa.text(
                "UPDATE bucket_migration_items "
                "SET execution_strategy = :strategy WHERE id = :id"
            ),
            {"id": row["id"], "strategy": strategy},
        )

    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.drop_column("execution_plan_json")


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.add_column(sa.Column("execution_plan_json", sa.Text(), nullable=True))

    rows = bind.execute(
        sa.text(
            "SELECT i.id, i.execution_strategy, "
            "m.precheck_status, m.precheck_report_json "
            "FROM bucket_migration_items AS i "
            "JOIN bucket_migrations AS m ON m.id = i.migration_id "
            "WHERE i.execution_strategy IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        plan = _legacy_plan(
            row["execution_strategy"],
            item_id=row["id"],
            precheck_status=row["precheck_status"],
            precheck_report_json=row["precheck_report_json"],
        )
        bind.execute(
            sa.text(
                "UPDATE bucket_migration_items "
                "SET execution_plan_json = :plan WHERE id = :id"
            ),
            {"id": row["id"], "plan": plan},
        )

    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.drop_column("execution_strategy")
