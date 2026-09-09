# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize Manager usage snapshot context identifiers.

Revision ID: 0124_canonical_manager_usage_scopes
Revises: 0123_canonical_ui_user_full_name
Create Date: 2026-09-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0124_canonical_manager_usage_scopes"
down_revision = "0123_canonical_ui_user_full_name"
branch_labels = None
depends_on = None


snapshots = sa.table(
    "bucket_usage_stats_snapshots",
    sa.column("id", sa.Integer()),
    sa.column("scope_kind", sa.String()),
    sa.column("scope_id", sa.String()),
    sa.column("bucket_name", sa.String()),
    sa.column("calculated_at"),
    sa.column("updated_at"),
)


def _canonical_scope_id(scope_id: str) -> str:
    # Freeze the accepted Manager selector grammar here, not in runtime code.
    prefix = next((value for value in ("conn-", "s3u-") if scope_id.startswith(value)), "")
    suffix = scope_id[len(prefix):]
    if prefix and not suffix.isdigit():
        return scope_id
    try:
        identifier = int(suffix)
    except ValueError:
        return scope_id
    return f"{prefix}{identifier}" if identifier > 0 else scope_id


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(snapshots.c.id, snapshots.c.scope_id, snapshots.c.bucket_name)
        .where(snapshots.c.scope_kind == "manager")
        .order_by(snapshots.c.calculated_at.desc(), snapshots.c.updated_at.desc(), snapshots.c.id.desc())
    ).all()
    seen: set[tuple[str, str]] = set()
    duplicates = []
    updates = []
    for row in rows:
        scope_id = _canonical_scope_id(row.scope_id)
        key = (scope_id, row.bucket_name)
        if key in seen:
            duplicates.append({"snapshot_id": row.id})
        else:
            seen.add(key)
            if scope_id != row.scope_id:
                updates.append({"snapshot_id": row.id, "canonical_scope_id": scope_id})

    # Remove older duplicate cache entries before renaming winners so the
    # existing unique (scope_kind, scope_id, bucket_name) constraint stays valid.
    if duplicates:
        bind.execute(
            snapshots.delete().where(snapshots.c.id == sa.bindparam("snapshot_id")),
            duplicates,
        )
    if updates:
        bind.execute(
            snapshots.update()
            .where(snapshots.c.id == sa.bindparam("snapshot_id"))
            .values(scope_id=sa.bindparam("canonical_scope_id")),
            updates,
        )


def downgrade() -> None:
    # Canonical latest snapshots remain readable by the previous release.
    # Historical selector spellings and superseded cache entries are not restored.
    pass
