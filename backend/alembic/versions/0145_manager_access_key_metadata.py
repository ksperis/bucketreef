# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Add optional Manager access-key metadata and resource opt-ins."""

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0145_manager_access_key_metadata"
down_revision = "0144_legacy_ceph_admin_system_compat"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("s3_accounts") as batch:
        batch.add_column(sa.Column("allow_access_key_metadata", sa.Boolean(), nullable=False, server_default=sa.false()))
    with op.batch_alter_table("s3_users") as batch:
        batch.add_column(sa.Column("allow_access_key_metadata", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "manager_access_key_metadata",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("principal_name", sa.String(length=256), nullable=True),
        sa.Column("access_key_id", sa.String(length=256), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            "(account_id IS NOT NULL AND s3_user_id IS NULL AND principal_name IS NOT NULL) OR "
            "(account_id IS NULL AND s3_user_id IS NOT NULL AND principal_name IS NULL)",
            name="ck_manager_access_key_metadata_scope",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["s3_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "principal_name", "access_key_id", name="uq_manager_access_key_metadata_iam"),
        sa.UniqueConstraint("s3_user_id", "access_key_id", name="uq_manager_access_key_metadata_s3_user"),
    )
    op.create_index(
        "ix_manager_access_key_metadata_access_key",
        "manager_access_key_metadata",
        ["access_key_id"],
        unique=False,
    )
    op.create_index("ix_manager_access_key_metadata_id", "manager_access_key_metadata", ["id"], unique=False)


def downgrade():
    op.drop_index("ix_manager_access_key_metadata_id", table_name="manager_access_key_metadata")
    op.drop_index("ix_manager_access_key_metadata_access_key", table_name="manager_access_key_metadata")
    op.drop_table("manager_access_key_metadata")
    with op.batch_alter_table("s3_users") as batch:
        batch.drop_column("allow_access_key_metadata")
    with op.batch_alter_table("s3_accounts") as batch:
        batch.drop_column("allow_access_key_metadata")
