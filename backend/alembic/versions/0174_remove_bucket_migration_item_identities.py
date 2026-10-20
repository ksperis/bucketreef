# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove duplicated identities from bucket migration precheck items.

Revision ID: 0174_remove_bucket_migration_item_identities
Revises: 0173_canonical_bucket_migration_severity
Create Date: 2026-10-20 19:20:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0174_remove_bucket_migration_item_identities"
down_revision = "0173_canonical_bucket_migration_severity"
branch_labels = None
depends_on = None


def _rewrite_report(
    raw: str | None,
    *,
    restore_identities: bool,
    source_context_id: str,
    target_context_id: str,
) -> str | None:
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
        if restore_identities:
            if "source_identity" not in item:
                item["source_identity"] = source_context_id
                changed = True
            if "target_identity" not in item:
                item["target_identity"] = target_context_id
                changed = True
            continue
        if "source_identity" in item:
            item.pop("source_identity", None)
            changed = True
        if "target_identity" in item:
            item.pop("target_identity", None)
            changed = True

    if not changed:
        return raw
    return json.dumps(report, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, restore_identities: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, source_context_id, target_context_id, precheck_report_json "
            "FROM bucket_migrations"
        )
    ).mappings()
    for row in rows:
        rewritten = _rewrite_report(
            row["precheck_report_json"],
            restore_identities=restore_identities,
            source_context_id=row["source_context_id"],
            target_context_id=row["target_context_id"],
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
    _rewrite_all(restore_identities=False)


def downgrade() -> None:
    _rewrite_all(restore_identities=True)
