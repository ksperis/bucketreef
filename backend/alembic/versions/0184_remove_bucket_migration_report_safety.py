# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove redundant bucket migration report safety booleans.

Revision ID: 0184_remove_bucket_migration_report_safety
Revises: 0183_remove_bucket_migration_delete_source
Create Date: 2026-10-24 17:45:00.000000
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0184_remove_bucket_migration_report_safety"
down_revision = "0183_remove_bucket_migration_delete_source"
branch_labels = None
depends_on = None

_SAFETY_FIELDS = ("rollback_safe", "same_endpoint_copy_safe")
_COPY_SUCCESS_CODES = {
    "same_endpoint_copy_validated",
    "same_endpoint_copy_validated_with_grant",
}


def _check_codes(item: dict[str, object]) -> set[str]:
    checks = item.get("checks")
    if not isinstance(checks, list):
        return set()
    return {
        str(check["code"])
        for check in checks
        if isinstance(check, dict) and check.get("code") is not None
    }


def _restore_item_safety(
    item: dict[str, object],
    *,
    same_endpoint_copy_enabled: bool,
) -> bool:
    changed = False
    codes = _check_codes(item)
    if "rollback_safe" not in item:
        item["rollback_safe"] = "rollback_not_safe" not in codes
        changed = True
    if "same_endpoint_copy_safe" not in item:
        item["same_endpoint_copy_safe"] = (
            not same_endpoint_copy_enabled or bool(codes & _COPY_SUCCESS_CODES)
        )
        changed = True
    return changed


def _rewrite_report(
    raw: str | None,
    *,
    restore_fields: bool,
    same_endpoint_copy_enabled: bool,
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
    report_items = (
        [item for item in items if isinstance(item, dict)]
        if isinstance(items, list)
        else []
    )
    changed = False
    if restore_fields:
        for item in report_items:
            changed = (
                _restore_item_safety(
                    item,
                    same_endpoint_copy_enabled=same_endpoint_copy_enabled,
                )
                or changed
            )
        if "rollback_safe" not in report:
            report["rollback_safe"] = all(
                bool(item.get("rollback_safe", True)) for item in report_items
            )
            changed = True
        if "same_endpoint_copy_safe" not in report:
            report["same_endpoint_copy_safe"] = all(
                bool(item.get("same_endpoint_copy_safe", True)) for item in report_items
            )
            changed = True
    else:
        for record in [report, *report_items]:
            for field in _SAFETY_FIELDS:
                if field in record:
                    record.pop(field, None)
                    changed = True

    if not changed:
        return raw
    return json.dumps(report, separators=(",", ":"), sort_keys=True)


def _rewrite_all(*, restore_fields: bool) -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, use_same_endpoint_copy, precheck_report_json "
            "FROM bucket_migrations"
        )
    ).mappings()
    for row in rows:
        rewritten = _rewrite_report(
            row["precheck_report_json"],
            restore_fields=restore_fields,
            same_endpoint_copy_enabled=bool(row["use_same_endpoint_copy"]),
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
    _rewrite_all(restore_fields=False)


def downgrade() -> None:
    _rewrite_all(restore_fields=True)
