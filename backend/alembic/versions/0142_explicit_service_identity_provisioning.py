# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Track managed endpoint identities that have not been provisioned yet."""

import sqlalchemy as sa
from alembic import op


revision = "0142_explicit_service_identity_provisioning"
down_revision = "0141_durable_key_rotation"
branch_labels = None
depends_on = None


_OLD_STATUS = "status IN ('missing', 'provisioning', 'ready', 'error', 'revocation_pending', 'disabled')"
_NEW_STATUS = "status IN ('not_provisioned', 'missing', 'provisioning', 'ready', 'error', 'revocation_pending', 'disabled')"


def _replace_status_constraint(sqltext: str) -> None:
    with op.batch_alter_table("endpoint_service_identities") as batch:
        batch.drop_constraint("ck_endpoint_service_identity_status", type_="check")
        batch.create_check_constraint("ck_endpoint_service_identity_status", sqltext)


def upgrade() -> None:
    _replace_status_constraint(_NEW_STATUS)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text(
            "SELECT 1 FROM endpoint_service_identities "
            "WHERE status = 'not_provisioned' LIMIT 1"
        )
    ).first() is not None:
        raise RuntimeError(
            "Provision or convert managed endpoint identities before downgrading."
        )
    _replace_status_constraint(_OLD_STATUS)
