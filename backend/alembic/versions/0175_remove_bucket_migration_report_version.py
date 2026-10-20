# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused bucket migration report version metadata.

Revision ID: 0175_remove_bucket_migration_report_version
Revises: 0174_remove_bucket_migration_item_identities
Create Date: 2026-10-20 18:59:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0175_remove_bucket_migration_report_version"
down_revision = "0174_remove_bucket_migration_item_identities"
branch_labels = None
depends_on = None

_LEGACY_REPORT_VERSION = 3


def _rewrite_payload(raw: str | None, *, restore_version: bool) -> str | None:
    if raw is None:
        return None
    try:
        payload = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(payload, dict):
        return raw

    if restore_version:
        if "report_version" in payload:
            return raw
        payload["report_version"] = _LEGACY_REPORT_VERSION
    else:
        if "report_version" not in payload:
            return raw
        payload.pop("report_version", None)

    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _rewrite_column(
    *,
    select_sql: str,
    update_sql: str,
    value_key: str,
    restore_version: bool,
) -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(select_sql)).mappings()
    for row in rows:
        rewritten = _rewrite_payload(
            row[value_key],
            restore_version=restore_version,
        )
        if rewritten == row[value_key]:
            continue
        bind.execute(
            sa.text(update_sql),
            {"id": row["id"], "payload": rewritten},
        )


def _rewrite_all(*, restore_version: bool) -> None:
    _rewrite_column(
        select_sql="SELECT id, precheck_report_json FROM bucket_migrations",
        update_sql=(
            "UPDATE bucket_migrations SET precheck_report_json = :payload WHERE id = :id"
        ),
        value_key="precheck_report_json",
        restore_version=restore_version,
    )
    _rewrite_column(
        select_sql="SELECT id, execution_plan_json FROM bucket_migration_items",
        update_sql=(
            "UPDATE bucket_migration_items SET execution_plan_json = :payload WHERE id = :id"
        ),
        value_key="execution_plan_json",
        restore_version=restore_version,
    )


def upgrade() -> None:
    _rewrite_all(restore_version=False)


def downgrade() -> None:
    _rewrite_all(restore_version=True)
