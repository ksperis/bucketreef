# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Track durable S3 user imports.

Revision ID: 0230_s3_user_import_intents
Revises: 0229_s3_account_deletion_state
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op


revision = "0230_s3_user_import_intents"
down_revision = "0229_s3_account_deletion_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "s3_user_import_intents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "storage_endpoint_id",
            sa.Integer(),
            sa.ForeignKey("storage_endpoints.id"),
            nullable=False,
        ),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
        sa.Column("rgw_tenant", sa.String(), nullable=False, server_default=""),
        sa.Column("requested_name", sa.String(), nullable=True),
        sa.Column("requested_email", sa.String(), nullable=True),
        sa.Column("access_key_id", sa.String(), nullable=False),
        sa.Column("secret_access_key", sa.String(), nullable=False),
        sa.Column("phase", sa.String(), nullable=False, server_default="prepared"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "phase IN ('prepared', 'creating', 'remote_created')",
            name="ck_s3_user_import_intents_phase",
        ),
        sa.UniqueConstraint(
            "storage_endpoint_id",
            "rgw_tenant",
            "rgw_user_uid",
            name="uq_s3_user_import_intents_identity",
        ),
    )
    op.create_index(
        "ix_s3_user_import_intents_id",
        "s3_user_import_intents",
        ["id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text("SELECT 1 FROM s3_user_import_intents LIMIT 1")
    ).first() is not None:
        raise RuntimeError(
            "Complete pending S3 user imports before downgrading."
        )
    op.drop_index("ix_s3_user_import_intents_id", table_name="s3_user_import_intents")
    op.drop_table("s3_user_import_intents")
