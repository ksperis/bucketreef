# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bind OIDC login state to the selected public origin.

Revision ID: 0129_oidc_login_state_redirect_uri
Revises: 0128_portal_setting_change_request
Create Date: 2026-09-23
"""

from alembic import op
import sqlalchemy as sa


revision = "0129_oidc_login_state_redirect_uri"
down_revision = "0128_portal_setting_change_request"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("oidc_login_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("redirect_uri", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("oidc_login_states", schema=None) as batch_op:
        batch_op.drop_column("redirect_uri")
