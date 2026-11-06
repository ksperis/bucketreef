# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize Browser favorites to the standalone Browser surface.

Revision ID: 0249_canonical_browser_favorites
Revises: 0248_remove_migration_runtime_timestamps
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0249_canonical_browser_favorites"
down_revision = "0248_remove_migration_runtime_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text("DELETE FROM browser_favorites WHERE surface <> 'browser'")
    )
    with op.batch_alter_table("browser_favorites") as batch:
        batch.drop_index("ix_browser_favorites_user_surface")
        batch.create_index("ix_browser_favorites_user_id", ["user_id"])
        batch.drop_column("surface")
        batch.drop_column("workspace")


def downgrade() -> None:
    with op.batch_alter_table("browser_favorites") as batch:
        batch.add_column(sa.Column("surface", sa.String(24), nullable=True))
        batch.add_column(sa.Column("workspace", sa.String(24), nullable=True))

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE browser_favorites "
            "SET surface = 'browser', workspace = 'browser'"
        )
    )

    with op.batch_alter_table("browser_favorites") as batch:
        batch.alter_column("surface", existing_type=sa.String(24), nullable=False)
        batch.alter_column("workspace", existing_type=sa.String(24), nullable=False)
        batch.drop_index("ix_browser_favorites_user_id")
        batch.create_index(
            "ix_browser_favorites_user_surface",
            ["user_id", "surface"],
        )
