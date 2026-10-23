# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize nullable bucket migration diagnostic fields.

Revision ID: 0182_canonical_bucket_migration_diagnostics
Revises: 0181_s3_user_bucket_usage_stats
Create Date: 2026-10-23 16:15:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0182_canonical_bucket_migration_diagnostics"
down_revision = "0181_s3_user_bucket_usage_stats"
branch_labels = None
depends_on = None

_NULLABLE_FIELDS = (
    "impact",
    "remediation",
    "permission",
    "context_id",
    "bucket",
    "details",
)


def _rewrite_checks(checks: object, *, add_nulls: bool) -> bool:
    if not isinstance(checks, list):
        return False
    changed = False
    for check in checks:
        if not isinstance(check, dict):
            continue
        for field in _NULLABLE_FIELDS:
            if add_nulls:
                if field not in check:
                    check[field] = None
                    changed = True
            elif check.get(field) is None and field in check:
                check.pop(field)
                changed = True
    return changed


def _rewrite_report(raw: str | None, *, add_nulls: bool) -> str | None:
    if raw is None:
        return None
    try:
        report = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(report, dict):
        return raw

    changed = _rewrite_checks(report.get("checks"), add_nulls=add_nulls)
    items = report.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                changed = _rewrite_checks(item.get("checks"), add_nulls=add_nulls) or changed

    if not changed:
        return raw
    return json.dumps(report, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, add_nulls: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, precheck_report_json FROM bucket_migrations")
    ).mappings()
    for row in rows:
        rewritten = _rewrite_report(
            row["precheck_report_json"],
            add_nulls=add_nulls,
        )
        if rewritten == row["precheck_report_json"]:
            continue
        bind.execute(
            sa.text(
                "UPDATE bucket_migrations SET precheck_report_json = :report WHERE id = :id"
            ),
            {"id": row["id"], "report": rewritten},
        )


def upgrade() -> None:
    _rewrite_all(add_nulls=True)


def downgrade() -> None:
    _rewrite_all(add_nulls=False)
