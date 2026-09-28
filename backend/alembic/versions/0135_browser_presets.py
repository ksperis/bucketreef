# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Personal Browser favorites and saved views with optimistic revisions."""
from alembic import op
import sqlalchemy as sa
from app.db.utc_datetime import UTCDateTime

revision = "0135_browser_presets"
down_revision = "0134_portal_collaborator_delegation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("browser_presets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("surface", sa.String(24), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False))
    op.create_index("ix_browser_presets_user_surface", "browser_presets", ["user_id", "surface"])


def downgrade():
    op.drop_index("ix_browser_presets_user_surface", table_name="browser_presets")
    op.drop_table("browser_presets")
