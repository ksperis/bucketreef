# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Allow Portal collaborator role-change requests.

Revision ID: 0133_portal_role_change_request
Revises: 0132_webhook_endpoints
Create Date: 2026-09-28
"""

from alembic import op
import sqlalchemy as sa


revision = "0133_portal_role_change_request"
down_revision = "0132_webhook_endpoints"
branch_labels = None
depends_on = None


_BASE_TYPES = (
    "'portal_user_access', 'portal_user_removal', "
    "'account_quota_change', 'portal_setting_change'"
)
_UPGRADED_TYPES = (
    "'portal_user_access', 'portal_user_removal', 'portal_role_change', "
    "'account_quota_change', 'portal_setting_change'"
)


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
            "WHERE request_type = 'portal_role_change' LIMIT 1"
        )
    ).first() is not None:
        raise RuntimeError("Cannot downgrade while portal_role_change requests exist.")
    _replace_request_type_constraint(f"request_type IN ({_BASE_TYPES})")
