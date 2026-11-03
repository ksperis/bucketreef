# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Track durable S3 account imports.

Revision ID: 0231_s3_account_import_intents
Revises: 0230_s3_user_import_intents
Create Date: 2026-11-04
"""

import sqlalchemy as sa
from alembic import op


revision = "0231_s3_account_import_intents"
down_revision = "0230_s3_user_import_intents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "s3_account_import_intents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "storage_endpoint_id",
            sa.Integer(),
            sa.ForeignKey("storage_endpoints.id"),
            nullable=False,
        ),
        sa.Column("rgw_account_id", sa.String(), nullable=False),
        sa.Column("rgw_tenant", sa.String(), nullable=False, server_default=""),
        sa.Column("root_uid", sa.String(), nullable=False),
        sa.Column("account_name", sa.String(), nullable=False),
        sa.Column("requested_name", sa.String(), nullable=True),
        sa.Column("requested_email", sa.String(), nullable=True),
        sa.Column("credential_action", sa.String(), nullable=False),
        sa.Column("access_key_id", sa.String(), nullable=False),
        sa.Column("secret_access_key", sa.String(), nullable=False),
        sa.Column("phase", sa.String(), nullable=False, server_default="prepared"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "credential_action IN ('reuse', 'create_root', 'create_key')",
            name="ck_s3_account_import_intents_credential_action",
        ),
        sa.CheckConstraint(
            "phase IN ('prepared', 'creating', 'remote_created')",
            name="ck_s3_account_import_intents_phase",
        ),
        sa.UniqueConstraint(
            "rgw_account_id",
            name="uq_s3_account_import_intents_rgw_account",
        ),
    )
    op.create_index(
        "ix_s3_account_import_intents_id",
        "s3_account_import_intents",
        ["id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text("SELECT 1 FROM s3_account_import_intents LIMIT 1")
    ).first() is not None:
        raise RuntimeError(
            "Complete pending S3 account imports before downgrading."
        )
    op.drop_index(
        "ix_s3_account_import_intents_id",
        table_name="s3_account_import_intents",
    )
    op.drop_table("s3_account_import_intents")
