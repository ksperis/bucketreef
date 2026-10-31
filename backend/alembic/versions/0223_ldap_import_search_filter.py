# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add the optional LDAP admin import search filter.

Revision ID: 0223_ldap_import_search_filter
Revises: 0222_external_identity_link_attempts
Create Date: 2026-10-31
"""

from alembic import op
import sqlalchemy as sa


revision = "0223_ldap_import_search_filter"
down_revision = "0222_external_identity_link_attempts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("import_search_filter", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.drop_column("import_search_filter")
