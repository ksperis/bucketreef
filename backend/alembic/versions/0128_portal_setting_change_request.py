# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Allow Portal project-setting change requests.

Revision ID: 0128_portal_setting_change_request
Revises: 0127_canonical_s3_identity_whitespace
Create Date: 2026-09-22
"""

from alembic import op
import sqlalchemy as sa


revision = "0128_portal_setting_change_request"
down_revision = "0127_canonical_s3_identity_whitespace"
branch_labels = None
depends_on = None


_BASE_TYPES = "'portal_user_access', 'portal_user_removal', 'account_quota_change'"
_UPGRADED_TYPES = f"{_BASE_TYPES}, 'portal_setting_change'"


def _replace_request_type_constraint(sqltext: str) -> None:
    with op.batch_alter_table("portal_admin_requests", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_admin_requests_type", type_="check")
        batch_op.create_check_constraint("ck_portal_admin_requests_type", sqltext)


def upgrade() -> None:
    _replace_request_type_constraint(f"request_type IN ({_UPGRADED_TYPES})")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(
        sa.text(
            "SELECT 1 FROM portal_admin_requests "
            "WHERE request_type = 'portal_setting_change' LIMIT 1"
        )
    ).first() is not None:
        raise RuntimeError(
            "Cannot downgrade while portal_setting_change requests exist."
        )
    _replace_request_type_constraint(f"request_type IN ({_BASE_TYPES})")
