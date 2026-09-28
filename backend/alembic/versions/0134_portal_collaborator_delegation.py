# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Delegate Portal collaborator management and canonicalize role changes.

Revision ID: 0134_portal_collaborator_delegation
Revises: 0133_portal_role_change_request
Create Date: 2026-09-28
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op


revision = "0134_portal_collaborator_delegation"
down_revision = "0133_portal_role_change_request"
branch_labels = None
depends_on = None


_BASE_TYPES = (
    "'portal_user_access', 'portal_user_removal', "
    "'account_quota_change', 'portal_setting_change'"
)
_LEGACY_TYPES = (
    "'portal_user_access', 'portal_user_removal', 'portal_role_change', "
    "'account_quota_change', 'portal_setting_change'"
)


def _replace_request_type_constraint(sqltext: str) -> None:
    with op.batch_alter_table("portal_admin_requests", schema=None) as batch_op:
        batch_op.drop_constraint("ck_portal_admin_requests_type", type_="check")
        batch_op.create_check_constraint("ck_portal_admin_requests_type", sqltext)


def _migrate_role_change_rows(*, to_intent: bool) -> None:
    bind = op.get_bind()
    requests = sa.table(
        "portal_admin_requests",
        sa.column("id", sa.Integer()),
        sa.column("request_type", sa.String()),
        sa.column("payload_json", sa.Text()),
    )
    if to_intent:
        rows = bind.execute(
            sa.select(requests.c.id, requests.c.payload_json).where(
                requests.c.request_type == "portal_role_change"
            )
        ).all()
        for request_id, payload_json in rows:
            payload = json.loads(payload_json)
            payload["intent"] = "role_change"
            bind.execute(
                requests.update()
                .where(requests.c.id == request_id)
                .values(
                    request_type="portal_user_access",
                    payload_json=json.dumps(payload, ensure_ascii=True, sort_keys=True),
                )
            )
        return

    rows = bind.execute(
        sa.select(requests.c.id, requests.c.payload_json).where(
            requests.c.request_type == "portal_user_access"
        )
    ).all()
    for request_id, payload_json in rows:
        payload = json.loads(payload_json)
        if payload.get("intent") != "role_change":
            continue
        payload.pop("intent", None)
        bind.execute(
            requests.update()
            .where(requests.c.id == request_id)
            .values(
                request_type="portal_role_change",
                payload_json=json.dumps(payload, ensure_ascii=True, sort_keys=True),
            )
        )


def upgrade() -> None:
    _migrate_role_change_rows(to_intent=True)
    _replace_request_type_constraint(f"request_type IN ({_BASE_TYPES})")
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "portal_collaborator_role_management_delegated",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch_op.add_column(
            sa.Column(
                "portal_collaborator_addition_delegated",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("s3_accounts", schema=None) as batch_op:
        batch_op.drop_column("portal_collaborator_addition_delegated")
        batch_op.drop_column("portal_collaborator_role_management_delegated")
    _replace_request_type_constraint(f"request_type IN ({_LEGACY_TYPES})")
    _migrate_role_change_rows(to_intent=False)
