# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Canonicalize persisted Portal collaborator addition requests."""

import json

import sqlalchemy as sa
from alembic import op


revision = "0156_canonical_portal_user_access_requests"
down_revision = "0155_canonical_audit_context"
branch_labels = None
depends_on = None


def _rewrite_requests(*, downgrade: bool) -> None:
    bind = op.get_bind()
    requests = sa.table(
        "portal_admin_requests",
        sa.column("id", sa.Integer()),
        sa.column("request_type", sa.String()),
        sa.column("payload_json", sa.Text()),
    )
    rows = bind.execute(
        sa.select(requests.c.id, requests.c.payload_json).where(
            requests.c.request_type == "portal_user_access"
        )
    ).all()
    for request_id, payload_json in rows:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise RuntimeError(
                f"Portal request {request_id} has a non-object payload; repair it before upgrading."
            )
        changed = False
        if downgrade:
            if payload.get("intent") == "add":
                payload.pop("intent")
                changed = True
            if payload.get("portal_role") == "portal_user":
                payload.pop("portal_role")
                changed = True
        else:
            if "intent" not in payload:
                payload["intent"] = "add"
                changed = True
            if payload.get("intent") == "add" and "portal_role" not in payload:
                payload["portal_role"] = "portal_user"
                changed = True
        if changed:
            bind.execute(
                requests.update()
                .where(requests.c.id == request_id)
                .values(
                    payload_json=json.dumps(
                        payload,
                        ensure_ascii=True,
                        sort_keys=True,
                    )
                )
            )


def upgrade() -> None:
    _rewrite_requests(downgrade=False)


def downgrade() -> None:
    _rewrite_requests(downgrade=True)
