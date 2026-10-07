# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Add optional Manager access-key expiration and resource opt-ins."""

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0146_manager_access_key_expiration"
down_revision = "0145_manager_access_key_metadata"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("allow_access_key_expiration", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("allow_access_key_expiration", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("manager_access_key_metadata") as batch:
        batch.add_column(sa.Column("expires_at", UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("expiration_state", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("expiration_enforced_at", UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("expiration_last_attempt_at", UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("expiration_last_error", sa.Text(), nullable=True))
        batch.create_index("ix_manager_access_key_metadata_expires_at", ["expires_at"], unique=False)


def downgrade():
    with op.batch_alter_table("manager_access_key_metadata") as batch:
        batch.drop_index("ix_manager_access_key_metadata_expires_at")
        batch.drop_column("expiration_last_error")
        batch.drop_column("expiration_last_attempt_at")
        batch.drop_column("expiration_enforced_at")
        batch.drop_column("expiration_state")
        batch.drop_column("expires_at")
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("allow_access_key_expiration")
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("allow_access_key_expiration")
