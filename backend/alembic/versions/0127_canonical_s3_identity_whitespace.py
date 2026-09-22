# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Trim persisted RGW identities and enforce canonical whitespace.

Revision ID: 0127_canonical_s3_identity_whitespace
Revises: 0126_canonical_s3_user_identities
Create Date: 2026-09-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0127_canonical_s3_identity_whitespace"
down_revision = "0126_canonical_s3_user_identities"
branch_labels = None
depends_on = None


_s3_accounts = sa.table(
    "s3_accounts",
    sa.column("id", sa.Integer()),
    sa.column("rgw_account_id", sa.String()),
    sa.column("rgw_user_uid", sa.String()),
)
_s3_users = sa.table(
    "s3_users",
    sa.column("id", sa.Integer()),
    sa.column("rgw_user_uid", sa.String()),
)


def _cleanup_stale_sqlite_batch_table(bind, table_name: str) -> None:
    if bind.dialect.name != "sqlite":
        return
    temporary_table = f"_alembic_tmp_{table_name}"
    table_names = set(sa.inspect(bind).get_table_names())
    if temporary_table not in table_names:
        return
    if table_name not in table_names:
        raise RuntimeError(
            f"Interrupted {table_name} schema migration detected: "
            f"{temporary_table} exists but {table_name} is missing. "
            "Restore the database backup before retrying the upgrade."
        )
    bind.exec_driver_sql(f'DROP TABLE "{temporary_table}"')


def _canonical_identity(value: object, *, row_id: int, field: str) -> str:
    if not isinstance(value, str):
        raise RuntimeError(f"Cannot canonicalize {field} for row {row_id}: expected a string.")
    normalized = value.strip()
    if not normalized:
        raise RuntimeError(f"Cannot canonicalize {field} for row {row_id}: identity is empty.")
    return normalized


def _reject_trim_collision(
    seen: dict[str, int],
    *,
    normalized: str,
    row_id: int,
    field: str,
) -> None:
    existing_id = seen.get(normalized)
    if existing_id is not None and existing_id != row_id:
        raise RuntimeError(
            f"Cannot canonicalize {field}: rows {existing_id} and {row_id} "
            f"both normalize to {normalized!r}. Repair the duplicate identities before upgrading."
        )
    seen[normalized] = row_id


def upgrade() -> None:
    bind = op.get_bind()
    _cleanup_stale_sqlite_batch_table(bind, "s3_accounts")
    _cleanup_stale_sqlite_batch_table(bind, "s3_users")
    account_rows = bind.execute(
        sa.select(
            _s3_accounts.c.id,
            _s3_accounts.c.rgw_account_id,
            _s3_accounts.c.rgw_user_uid,
        ).order_by(_s3_accounts.c.id.asc())
    ).all()
    user_rows = bind.execute(
        sa.select(_s3_users.c.id, _s3_users.c.rgw_user_uid).order_by(_s3_users.c.id.asc())
    ).all()

    account_ids: dict[str, int] = {}
    user_ids: dict[str, int] = {}
    canonical_accounts: list[tuple[int, str, str]] = []
    canonical_users: list[tuple[int, str]] = []

    for row in account_rows:
        row_id = int(row.id)
        account_id = _canonical_identity(
            row.rgw_account_id,
            row_id=row_id,
            field="s3_accounts.rgw_account_id",
        )
        user_uid = _canonical_identity(
            row.rgw_user_uid,
            row_id=row_id,
            field="s3_accounts.rgw_user_uid",
        )
        _reject_trim_collision(
            account_ids,
            normalized=account_id,
            row_id=row_id,
            field="s3_accounts.rgw_account_id",
        )
        canonical_accounts.append((row_id, account_id, user_uid))

    for row in user_rows:
        row_id = int(row.id)
        user_uid = _canonical_identity(
            row.rgw_user_uid,
            row_id=row_id,
            field="s3_users.rgw_user_uid",
        )
        _reject_trim_collision(
            user_ids,
            normalized=user_uid,
            row_id=row_id,
            field="s3_users.rgw_user_uid",
        )
        canonical_users.append((row_id, user_uid))

    for row_id, account_id, user_uid in canonical_accounts:
        bind.execute(
            _s3_accounts.update()
            .where(_s3_accounts.c.id == row_id)
            .values(rgw_account_id=account_id, rgw_user_uid=user_uid)
        )
    for row_id, user_uid in canonical_users:
        bind.execute(
            _s3_users.update()
            .where(_s3_users.c.id == row_id)
            .values(rgw_user_uid=user_uid)
        )

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_constraint("ck_s3_accounts_rgw_account_id_nonempty", type_="check")
        batch_op.drop_constraint("ck_s3_accounts_rgw_user_uid_nonempty", type_="check")
        batch_op.create_check_constraint(
            "ck_s3_accounts_rgw_account_id_canonical",
            "rgw_account_id = TRIM(rgw_account_id) AND LENGTH(rgw_account_id) > 0",
        )
        batch_op.create_check_constraint(
            "ck_s3_accounts_rgw_user_uid_canonical",
            "rgw_user_uid = TRIM(rgw_user_uid) AND LENGTH(rgw_user_uid) > 0",
        )

    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_constraint("ck_s3_users_rgw_user_uid_nonempty", type_="check")
        batch_op.create_check_constraint(
            "ck_s3_users_rgw_user_uid_canonical",
            "rgw_user_uid = TRIM(rgw_user_uid) AND LENGTH(rgw_user_uid) > 0",
        )


def downgrade() -> None:
    bind = op.get_bind()
    _cleanup_stale_sqlite_batch_table(bind, "s3_accounts")
    _cleanup_stale_sqlite_batch_table(bind, "s3_users")
    with op.batch_alter_table("s3_users", schema=None) as batch_op:
        batch_op.drop_constraint("ck_s3_users_rgw_user_uid_canonical", type_="check")
        batch_op.create_check_constraint(
            "ck_s3_users_rgw_user_uid_nonempty",
            "TRIM(rgw_user_uid) <> ''",
        )

    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_constraint("ck_s3_accounts_rgw_user_uid_canonical", type_="check")
        batch_op.drop_constraint("ck_s3_accounts_rgw_account_id_canonical", type_="check")
        batch_op.create_check_constraint(
            "ck_s3_accounts_rgw_account_id_nonempty",
            "TRIM(rgw_account_id) <> ''",
        )
        batch_op.create_check_constraint(
            "ck_s3_accounts_rgw_user_uid_nonempty",
            "TRIM(rgw_user_uid) <> ''",
        )
