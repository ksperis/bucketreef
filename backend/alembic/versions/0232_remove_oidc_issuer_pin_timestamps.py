# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused OIDC issuer pin timestamps.

Revision ID: 0232_remove_oidc_issuer_pin_timestamps
Revises: 0231_s3_account_import_intents
Create Date: 2026-11-04
"""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0232_remove_oidc_issuer_pin_timestamps"
down_revision = "0231_s3_account_import_intents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("oidc_provider_issuer_pins") as batch_op:
        batch_op.drop_column("last_verified_at")
        batch_op.drop_column("created_at")


def downgrade() -> None:
    with op.batch_alter_table("oidc_provider_issuer_pins") as batch_op:
        batch_op.add_column(sa.Column("created_at", UTCDateTime(), nullable=True))
        batch_op.add_column(
            sa.Column("last_verified_at", UTCDateTime(), nullable=True)
        )

    restored_at = datetime.now(timezone.utc)
    pins = sa.table(
        "oidc_provider_issuer_pins",
        sa.column("created_at", UTCDateTime()),
        sa.column("last_verified_at", UTCDateTime()),
    )
    op.execute(
        pins.update().values(
            created_at=restored_at,
            last_verified_at=restored_at,
        )
    )

    with op.batch_alter_table("oidc_provider_issuer_pins") as batch_op:
        batch_op.alter_column(
            "created_at",
            existing_type=UTCDateTime(),
            nullable=False,
        )
        batch_op.alter_column(
            "last_verified_at",
            existing_type=UTCDateTime(),
            nullable=False,
        )
