# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Track durable Portal external-credential revocation.

Revision ID: 0226_portal_external_credential_revocation
Revises: 0225_canonical_user_avatar_preference
Create Date: 2026-11-03
"""

import sqlalchemy as sa
from alembic import op


revision = "0226_portal_external_credential_revocation"
down_revision = "0225_canonical_user_avatar_preference"
branch_labels = None
depends_on = None


_OLD_STATUS = "status IN ('Active', 'Inactive')"
_NEW_STATUS = "status IN ('Active', 'Inactive', 'RevocationPending')"


def _replace_status_constraint(sqltext: str) -> None:
    with op.batch_alter_table("portal_external_access_credentials") as batch:
        batch.drop_constraint("ck_portal_external_access_credentials_status", type_="check")
        batch.create_check_constraint("ck_portal_external_access_credentials_status", sqltext)


def upgrade() -> None:
    _replace_status_constraint(_NEW_STATUS)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text(
            "SELECT 1 FROM portal_external_access_credentials "
            "WHERE status = 'RevocationPending' LIMIT 1"
        )
    ).first() is not None:
        raise RuntimeError(
            "Complete pending Portal external-credential revocations before downgrading."
        )
    _replace_status_constraint(_OLD_STATUS)
