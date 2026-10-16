# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Replace polymorphic connection owner metadata with canonical RGW identity."""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op


revision = "0158_connection_rgw_identity"
down_revision = "0157_canonical_audit_status"
branch_labels = None
depends_on = None

_ACCOUNT_ID_PATTERN = re.compile(r"^RGW\d{17}$", re.IGNORECASE)


def _is_account_id(value: str | None) -> bool:
    return bool(value and _ACCOUNT_ID_PATTERN.fullmatch(value.strip()))


def _canonical_identity(
    owner_type: str | None,
    owner_identifier: str | None,
) -> tuple[str | None, str | None, str | None]:
    """One-time conversion of every historical owner-identifier shape."""
    type_slug = (owner_type or "").strip().lower()
    identifier = (owner_identifier or "").strip()
    if not identifier:
        return None, None, None

    if "$" in identifier:
        prefix, principal = (part.strip() for part in identifier.split("$", 1))
        if not prefix or not principal:
            return None, None, None
        if _is_account_id(prefix):
            return None, None, prefix.upper()
        if type_slug == "s3_user":
            return principal, prefix, None
        return None, None, None

    if type_slug == "account_user":
        if ":" not in identifier:
            return None, None, None
        account_id, principal = (part.strip() for part in identifier.split(":", 1))
        if not _is_account_id(account_id) or not principal:
            return None, None, None
        return None, None, account_id.upper()

    if type_slug == "iam_user":
        candidate = identifier.split(":", 1)[1].strip() if identifier.lower().startswith("iam:") else identifier
        if ":" in candidate:
            account_id, principal = (part.strip() for part in candidate.split(":", 1))
            if _is_account_id(account_id) and principal:
                return None, None, account_id.upper()
        return None, None, None

    if type_slug == "s3_user":
        if ":" in identifier or identifier.lower().startswith("iam:"):
            return None, None, None
        return identifier, "", None

    return None, None, None


def upgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("s3_connections") as batch:
        batch.add_column(sa.Column("rgw_user_uid", sa.String(), nullable=True))
        batch.add_column(sa.Column("rgw_tenant", sa.String(), nullable=True))
        batch.add_column(sa.Column("rgw_account_id", sa.String(), nullable=True))

    connections = sa.table(
        "s3_connections",
        sa.column("id", sa.Integer()),
        sa.column("credential_owner_type", sa.String()),
        sa.column("credential_owner_identifier", sa.String()),
        sa.column("rgw_user_uid", sa.String()),
        sa.column("rgw_tenant", sa.String()),
        sa.column("rgw_account_id", sa.String()),
    )
    rows = bind.execute(
        sa.select(
            connections.c.id,
            connections.c.credential_owner_type,
            connections.c.credential_owner_identifier,
        )
    ).all()
    for connection_id, owner_type, owner_identifier in rows:
        user_uid, tenant, account_id = _canonical_identity(owner_type, owner_identifier)
        bind.execute(
            connections.update()
            .where(connections.c.id == connection_id)
            .values(
                rgw_user_uid=user_uid,
                rgw_tenant=tenant,
                rgw_account_id=account_id,
            )
        )

    with op.batch_alter_table("s3_connections") as batch:
        batch.drop_constraint("ck_s3_connections_credential_owner_type", type_="check")
        batch.drop_column("credential_owner_identifier")
        batch.drop_column("credential_owner_type")


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("s3_connections") as batch:
        batch.add_column(sa.Column("credential_owner_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("credential_owner_identifier", sa.String(), nullable=True))

    connections = sa.table(
        "s3_connections",
        sa.column("id", sa.Integer()),
        sa.column("rgw_user_uid", sa.String()),
        sa.column("rgw_tenant", sa.String()),
        sa.column("rgw_account_id", sa.String()),
        sa.column("credential_owner_type", sa.String()),
        sa.column("credential_owner_identifier", sa.String()),
    )
    rows = bind.execute(
        sa.select(
            connections.c.id,
            connections.c.rgw_user_uid,
            connections.c.rgw_tenant,
            connections.c.rgw_account_id,
        )
    ).all()
    for connection_id, user_uid, tenant, account_id in rows:
        owner_type = None
        owner_identifier = None
        if user_uid:
            owner_type = "s3_user"
            owner_identifier = f"{tenant}${user_uid}" if tenant else user_uid
        elif account_id:
            owner_type = "account_user"
            owner_identifier = account_id
        bind.execute(
            connections.update()
            .where(connections.c.id == connection_id)
            .values(
                credential_owner_type=owner_type,
                credential_owner_identifier=owner_identifier,
            )
        )

    with op.batch_alter_table("s3_connections") as batch:
        batch.create_check_constraint(
            "ck_s3_connections_credential_owner_type",
            "credential_owner_type IS NULL OR "
            "credential_owner_type IN ('iam_user', 'account_user', 's3_user')",
        )
        batch.drop_column("rgw_account_id")
        batch.drop_column("rgw_tenant")
        batch.drop_column("rgw_user_uid")
