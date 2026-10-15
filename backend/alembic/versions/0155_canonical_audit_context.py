# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Remove legacy audit account columns after canonical context backfill."""

import sqlalchemy as sa
from alembic import op

revision = "0155_canonical_audit_context"
down_revision = "0154_bucket_usage_stats_collection_policy"
branch_labels = None
depends_on = None


def upgrade():
    # Migration 0150 backfilled historical account-scoped rows. Repeat the
    # canonicalization for rows written since then while the compatibility
    # columns were still populated.
    op.execute(
        sa.text(
            "UPDATE audit_logs "
            "SET context_kind = CASE "
            "WHEN scope = 'portal' AND (context_kind IS NULL OR context_kind = 'account') "
            "THEN 'portal_account' "
            "ELSE COALESCE(context_kind, 'account') END, "
            "context_id = COALESCE(context_id, CAST(account_id AS VARCHAR)), "
            "context_name = COALESCE(context_name, account_name) "
            "WHERE account_id IS NOT NULL"
        )
    )

    with op.batch_alter_table("audit_logs") as batch:
        batch.drop_index("ix_audit_logs_account_id_id")
        batch.drop_column("account_name")
        batch.drop_column("account_id")


def downgrade():
    with op.batch_alter_table("audit_logs") as batch:
        batch.add_column(sa.Column("account_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("account_name", sa.String(), nullable=True))
        batch.create_foreign_key(
            "fk_audit_logs_account_id_s3_accounts",
            "s3_accounts",
            ["account_id"],
            ["id"],
        )
        batch.create_index(
            "ix_audit_logs_account_id_id",
            ["account_id", "id"],
            unique=False,
        )

    op.execute(
        sa.text(
            "UPDATE audit_logs "
            "SET account_id = ("
            "SELECT s3_accounts.id FROM s3_accounts "
            "WHERE CAST(s3_accounts.id AS VARCHAR) = audit_logs.context_id"
            "), "
            "account_name = context_name "
            "WHERE context_kind IN ('account', 'portal_account')"
        )
    )
