# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Merge Browser presets and bucket migration workflow heads."""

revision = "0136_merge_browser_migration_heads"
down_revision = (
    "0135_bucket_migration_workflow",
    "0135_browser_presets",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
