# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Attach audit events to their S3 execution context."""

import sqlalchemy as sa
from alembic import op

revision = "0150_audit_execution_context"
down_revision = "0149_manager_activity_history"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("audit_logs") as batch:
        batch.add_column(sa.Column("context_kind", sa.String(), nullable=True))
        batch.add_column(sa.Column("context_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("context_name", sa.String(), nullable=True))
        batch.create_index(
            "ix_audit_logs_context_kind_id_id",
            ["context_kind", "context_id", "id"],
            unique=False,
        )

    # Existing account-scoped rows are the only historical events that can be
    # backfilled without guessing. Older RGW User / connection events did not
    # persist their execution-context identifier.
    op.execute(
        sa.text(
            "UPDATE audit_logs "
            "SET context_kind = 'account', "
            "context_id = CAST(account_id AS VARCHAR), "
            "context_name = account_name "
            "WHERE account_id IS NOT NULL"
        )
    )

    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("allow_activity_history", sa.Boolean(), nullable=True))
    with op.batch_alter_table("s3_connections") as batch:
        batch.add_column(sa.Column("allow_activity_history", sa.Boolean(), nullable=True))


def downgrade():
    with op.batch_alter_table("s3_connections") as batch:
        batch.drop_column("allow_activity_history")
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("allow_activity_history")
    with op.batch_alter_table("audit_logs") as batch:
        batch.drop_index("ix_audit_logs_context_kind_id_id")
        batch.drop_column("context_name")
        batch.drop_column("context_id")
        batch.drop_column("context_kind")
