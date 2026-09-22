# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Require a non-empty RGW identity for every persisted S3 user.

Revision ID: 0126_canonical_s3_user_identities
Revises: 0125_guided_onboarding
Create Date: 2026-09-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0126_canonical_s3_user_identities"
down_revision = "0125_guided_onboarding"
branch_labels = None
depends_on = None


_s3_users = sa.table(
    "s3_users",
    sa.column("id", sa.Integer()),
    sa.column("name", sa.String()),
    sa.column("rgw_user_uid", sa.String()),
)


def upgrade() -> None:
    bind = op.get_bind()
    incomplete_rows = bind.execute(
        sa.select(
            _s3_users.c.id,
            _s3_users.c.name,
        )
        .where(sa.func.trim(_s3_users.c.rgw_user_uid) == "")
        .order_by(_s3_users.c.id.asc())
    ).all()
    if incomplete_rows:
        users = ", ".join(
            f"{int(row.id)} ({row.name or 'unnamed'})"
            for row in incomplete_rows[:10]
        )
        suffix = " ..." if len(incomplete_rows) > 10 else ""
        raise RuntimeError(
            "Cannot migrate S3 users with empty RGW identities: "
            f"{users}{suffix}. Repair rgw_user_uid before upgrading."
        )

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.create_check_constraint(
            "ck_s3_users_rgw_user_uid_nonempty",
            "TRIM(rgw_user_uid) <> ''",
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_s3_users_rgw_user_uid_nonempty",
            type_="check",
        )
