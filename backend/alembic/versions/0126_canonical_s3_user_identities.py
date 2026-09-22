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


def _cleanup_stale_sqlite_batch_table(bind) -> None:
    if bind.dialect.name != "sqlite":
        return
    table_names = set(sa.inspect(bind).get_table_names())
    temporary_table = "_alembic_tmp_s3_users"
    if temporary_table not in table_names:
        return
    if "s3_users" not in table_names:
        raise RuntimeError(
            "Interrupted S3 user schema migration detected: "
            "_alembic_tmp_s3_users exists but s3_users is missing. "
            "Restore the database backup before retrying the upgrade."
        )
    bind.exec_driver_sql("DROP TABLE _alembic_tmp_s3_users")


def upgrade() -> None:
    bind = op.get_bind()
    _cleanup_stale_sqlite_batch_table(bind)
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
    _cleanup_stale_sqlite_batch_table(op.get_bind())
    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_constraint(
            "ck_s3_users_rgw_user_uid_nonempty",
            type_="check",
        )
