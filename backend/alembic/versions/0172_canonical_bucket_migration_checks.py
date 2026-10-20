# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize bucket migration precheck diagnostics.

Revision ID: 0172_canonical_bucket_migration_checks
Revises: 0171_s3_user_rgw_usage_metrics
Create Date: 2026-10-20 18:45:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0172_canonical_bucket_migration_checks"
down_revision = "0171_s3_user_rgw_usage_metrics"
branch_labels = None
depends_on = None


def _rewrite_report(raw: str | None, *, restore_messages: bool) -> str | None:
    if raw is None:
        return None
    try:
        report = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(report, dict):
        return raw
    items = report.get("items")
    if not isinstance(items, list):
        return raw

    changed = False
    for item in items:
        if not isinstance(item, dict):
            continue
        checks = item.get("checks")
        messages = item.get("messages")
        if restore_messages:
            if "messages" not in item and isinstance(checks, list):
                item["messages"] = checks
                changed = True
            continue
        if not isinstance(checks, list) and isinstance(messages, list):
            item["checks"] = messages
            changed = True
        if "messages" in item:
            item.pop("messages", None)
            changed = True

    if not changed:
        return raw
    return json.dumps(report, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, restore_messages: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, precheck_report_json FROM bucket_migrations")
    ).mappings()
    for row in rows:
        rewritten = _rewrite_report(
            row["precheck_report_json"],
            restore_messages=restore_messages,
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
    _rewrite_all(restore_messages=False)


def downgrade() -> None:
    _rewrite_all(restore_messages=True)
