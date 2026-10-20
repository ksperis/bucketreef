# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize bucket migration diagnostic severity.

Revision ID: 0173_canonical_bucket_migration_severity
Revises: 0172_canonical_bucket_migration_checks
Create Date: 2026-10-20 19:05:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0173_canonical_bucket_migration_severity"
down_revision = "0172_canonical_bucket_migration_checks"
branch_labels = None
depends_on = None


def _rewrite_checks(checks: object, *, restore_level: bool) -> bool:
    if not isinstance(checks, list):
        return False
    changed = False
    for check in checks:
        if not isinstance(check, dict):
            continue
        severity = check.get("severity")
        level = check.get("level")
        if restore_level:
            if "level" not in check and isinstance(severity, str):
                check["level"] = severity
                changed = True
            continue
        if not isinstance(severity, str) and isinstance(level, str):
            check["severity"] = level
            changed = True
        if "level" in check:
            check.pop("level", None)
            changed = True
    return changed


def _rewrite_report(raw: str | None, *, restore_level: bool) -> str | None:
    if raw is None:
        return None
    try:
        report = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(report, dict):
        return raw

    changed = _rewrite_checks(report.get("checks"), restore_level=restore_level)
    items = report.get("items")
    if isinstance(items, list):
        for item in items:
            if isinstance(item, dict):
                changed = (
                    _rewrite_checks(item.get("checks"), restore_level=restore_level)
                    or changed
                )

    if not changed:
        return raw
    return json.dumps(report, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, restore_level: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, precheck_report_json FROM bucket_migrations")
    ).mappings()
    for row in rows:
        rewritten = _rewrite_report(
            row["precheck_report_json"],
            restore_level=restore_level,
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
    _rewrite_all(restore_level=False)


def downgrade() -> None:
    _rewrite_all(restore_level=True)
