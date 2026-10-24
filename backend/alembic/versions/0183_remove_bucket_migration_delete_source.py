# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove obsolete bucket migration source-deletion configuration.

Revision ID: 0183_remove_bucket_migration_delete_source
Revises: 0182_canonical_bucket_migration_diagnostics
Create Date: 2026-10-24 17:20:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0183_remove_bucket_migration_delete_source"
down_revision = "0182_canonical_bucket_migration_diagnostics"
branch_labels = None
depends_on = None

_REPORT_FIELD = "delete_source_safe"


def _rewrite_report(raw: str | None, *, restore_field: bool) -> str | None:
    if raw is None:
        return None
    try:
        report = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(report, dict):
        return raw

    changed = False
    records = [report]
    items = report.get("items")
    if isinstance(items, list):
        records.extend(item for item in items if isinstance(item, dict))
    for record in records:
        if restore_field:
            if _REPORT_FIELD not in record:
                record[_REPORT_FIELD] = True
                changed = True
        elif _REPORT_FIELD in record:
            record.pop(_REPORT_FIELD, None)
            changed = True

    if not changed:
        return raw
    return json.dumps(report, separators=(",", ":"), sort_keys=True)


def _rewrite_all_reports(*, restore_field: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, precheck_report_json FROM bucket_migrations")
    ).mappings()
    for row in rows:
        rewritten = _rewrite_report(
            row["precheck_report_json"],
            restore_field=restore_field,
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
    _rewrite_all_reports(restore_field=False)
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_column("delete_source")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(
            sa.Column(
                "delete_source",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
    _rewrite_all_reports(restore_field=True)
