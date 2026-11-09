# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize Portal Storage Space provenance values.

Revision ID: 0262_canonical_portal_storage_space_origin
Revises: 0261_canonical_onboarding_resources
Create Date: 2026-11-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0262_canonical_portal_storage_space_origin"
down_revision = "0261_canonical_onboarding_resources"
branch_labels = None
depends_on = None


_CONSTRAINT_NAME = "ck_portal_storage_space_metadata_origin"


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE portal_storage_space_metadata "
            "SET origin = 'imported' "
            "WHERE origin IS NULL "
            "OR origin NOT IN ('portal_generic', 'portal_named', 'imported')"
        )
    )
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.create_check_constraint(
            _CONSTRAINT_NAME,
            "origin IN ('portal_generic', 'portal_named', 'imported')",
        )


def downgrade() -> None:
    with op.batch_alter_table("portal_storage_space_metadata", schema=None) as batch_op:
        batch_op.drop_constraint(_CONSTRAINT_NAME, type_="check")
