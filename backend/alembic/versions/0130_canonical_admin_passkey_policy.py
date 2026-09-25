# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Persist the historical Admin passkey policy before removing runtime compatibility.

Revision ID: 0130_canonical_admin_passkey_policy
Revises: 0129_oidc_login_state_redirect_uri
Create Date: 2026-09-25
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0130_canonical_admin_passkey_policy"
down_revision = "0129_oidc_login_state_redirect_uri"
branch_labels = None
depends_on = None


_FIELD = "require_passkey_for_admins"


def _load_payload(raw: object, *, location: str) -> dict:
    try:
        payload = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{location} must contain a JSON object") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{location} must contain a JSON object")

    if "general" not in payload:
        return payload

    general = payload["general"]
    if not isinstance(general, dict):
        raise ValueError(f"{location}.general must contain a JSON object")
    if _FIELD in general and not isinstance(general[_FIELD], bool):
        raise ValueError(f"{location}.general.{_FIELD} must be a boolean")
    return payload


def _dump_payload(payload: dict) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT key, payload_json FROM app_settings")
    ).mappings().all()

    updates: list[dict[str, str]] = []
    for row in rows:
        payload = _load_payload(
            row["payload_json"],
            location=f"app_settings[{row['key']}].payload_json",
        )
        general = payload.get("general")
        if general is None:
            general = {}
            payload["general"] = general
        if _FIELD in general:
            continue
        general[_FIELD] = True
        updates.append(
            {"key": row["key"], "payload_json": _dump_payload(payload)}
        )

    for values in updates:
        bind.execute(
            sa.text(
                "UPDATE app_settings SET payload_json = :payload_json WHERE key = :key"
            ),
            values,
        )


def downgrade() -> None:
    # The migration cannot distinguish a policy that predated this revision
    # from one inserted to preserve the historical runtime behavior.
    pass
