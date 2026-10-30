# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Persist review context for external identity link requests.

Revision ID: 0221_identity_link_request_context
Revises: 0220_oidc_secure_account_linking
Create Date: 2026-10-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0221_identity_link_request_context"
down_revision = "0220_oidc_secure_account_linking"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("external_identity_link_requests", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "email_verified",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.add_column(sa.Column("request_source", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("external_identity_link_requests", schema=None) as batch_op:
        batch_op.drop_column("request_source")
        batch_op.drop_column("email_verified")
