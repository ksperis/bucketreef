# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Materialize the Manager Browser data-access feature policy.

Revision ID: 0273_manager_browser_data_access_policy
Revises: 0272_resource_feature_switches
Create Date: 2026-11-13
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0273_manager_browser_data_access_policy"
down_revision = "0272_resource_feature_switches"
branch_labels = None
depends_on = None


_SETTINGS_KEY = "default"
_FIELD = "manager_browser_data_access"
_DEFAULT = "disabled"
_VALID_POLICIES = {"disabled", "targeted", "default_on"}

app_settings = sa.table(
    "app_settings",
    sa.column("key", sa.String()),
    sa.column("payload", sa.JSON()),
)


def _canonicalize_payload(raw: object) -> tuple[dict, bool]:
    if not isinstance(raw, dict):
        raise ValueError("app_settings[default].payload must contain a JSON object")

    payload = dict(raw)
    raw_manager = payload.get("manager", {})
    if not isinstance(raw_manager, dict):
        raise ValueError("app_settings[default].payload.manager must contain a JSON object")
    manager = dict(raw_manager)

    raw_policies = manager.get("feature_policies", {})
    if not isinstance(raw_policies, dict):
        raise ValueError(
            "app_settings[default].payload.manager.feature_policies must contain a JSON object"
        )
    policies = dict(raw_policies)

    if _FIELD in policies:
        if policies[_FIELD] not in _VALID_POLICIES:
            raise ValueError(
                "app_settings[default].payload.manager.feature_policies."
                f"{_FIELD} must contain a valid feature policy"
            )
        return payload, False

    policies[_FIELD] = _DEFAULT
    manager["feature_policies"] = policies
    payload["manager"] = manager
    return payload, True


def upgrade() -> None:
    bind = op.get_bind()
    row = bind.execute(
        sa.select(app_settings.c.payload).where(app_settings.c.key == _SETTINGS_KEY)
    ).first()
    if row is None:
        return

    payload, changed = _canonicalize_payload(row.payload)
    if changed:
        bind.execute(
            app_settings.update()
            .where(app_settings.c.key == _SETTINGS_KEY)
            .values(payload=payload)
        )


def downgrade() -> None:
    bind = op.get_bind()
    row = bind.execute(
        sa.select(app_settings.c.payload).where(app_settings.c.key == _SETTINGS_KEY)
    ).first()
    if row is None or not isinstance(row.payload, dict):
        return

    payload = dict(row.payload)
    raw_manager = payload.get("manager")
    if not isinstance(raw_manager, dict):
        return
    manager = dict(raw_manager)
    raw_policies = manager.get("feature_policies")
    if not isinstance(raw_policies, dict) or _FIELD not in raw_policies:
        return

    policies = dict(raw_policies)
    policies.pop(_FIELD)
    manager["feature_policies"] = policies
    payload["manager"] = manager
    bind.execute(
        app_settings.update()
        .where(app_settings.c.key == _SETTINGS_KEY)
        .values(payload=payload)
    )
