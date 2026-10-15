# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Canonicalize persisted audit status values."""

import sqlalchemy as sa
from alembic import op


revision = "0157_canonical_audit_status"
down_revision = "0156_canonical_portal_user_access_requests"
branch_labels = None
depends_on = None

CANONICAL_STATUSES = ("success", "failure", "partial")
STATUS_ALIASES = {
    "success": ("success",),
    "failure": ("failure", "failed", "error"),
    "partial": ("partial",),
}


def upgrade() -> None:
    bind = op.get_bind()
    audit_logs = sa.table("audit_logs", sa.column("status", sa.String()))
    normalized_status = sa.func.lower(sa.func.trim(audit_logs.c.status))
    for canonical_status, aliases in STATUS_ALIASES.items():
        op.execute(
            audit_logs.update()
            .where(normalized_status.in_(aliases))
            .values(status=canonical_status)
        )

    unknown = bind.execute(
        sa.select(audit_logs.c.status)
        .where(audit_logs.c.status.notin_(CANONICAL_STATUSES))
        .distinct()
    ).scalars().all()
    if unknown:
        labels = ", ".join(sorted(repr(value) for value in unknown))
        raise RuntimeError(
            f"Unknown audit status value(s): {labels}. Repair them before upgrading."
        )

    with op.batch_alter_table("audit_logs") as batch:
        batch.create_check_constraint(
            "ck_audit_logs_status",
            "status IN ('success', 'failure', 'partial')",
        )


def downgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch:
        batch.drop_constraint("ck_audit_logs_status", type_="check")
