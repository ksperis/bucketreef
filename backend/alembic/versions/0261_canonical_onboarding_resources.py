# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize guided onboarding checkpoint resources.

Revision ID: 0261_canonical_onboarding_resources
Revises: 0260_onboarding_endpoint_checkpoint
Create Date: 2026-11-07
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0261_canonical_onboarding_resources"
down_revision = "0260_onboarding_endpoint_checkpoint"
branch_labels = None
depends_on = None


_ALLOWED_KEYS = {
    "endpoint_created",
    "endpoint_name",
    "rgw_account_id",
    "account_name",
    "account_id",
    "connection_id",
}


def _positive_integer(value: object, *, field: str, journey_id: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(
            f"Onboarding journey {journey_id} resource {field} must be a positive integer"
        )
    return value


def _non_empty_string(value: object, *, field: str, journey_id: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(
            f"Onboarding journey {journey_id} resource {field} must be a non-empty string"
        )
    return value


def _canonical_resources(
    journey_id: str,
    draft: object,
    resources: object,
) -> dict:
    if not isinstance(draft, dict) or not isinstance(resources, dict):
        raise ValueError("Onboarding journey draft and resources must be JSON objects")

    unknown = sorted(set(resources) - _ALLOWED_KEYS)
    if unknown:
        raise ValueError(
            f"Onboarding journey {journey_id} contains unknown resource keys: "
            + ", ".join(unknown)
        )

    for field in ("endpoint_name", "rgw_account_id", "account_name"):
        if field in resources:
            _non_empty_string(resources[field], field=field, journey_id=journey_id)
    for field in ("account_id", "connection_id"):
        if field in resources:
            _positive_integer(resources[field], field=field, journey_id=journey_id)
    if "endpoint_created" in resources and resources["endpoint_created"] is not True:
        raise ValueError(
            f"Onboarding journey {journey_id} resource endpoint_created must be true"
        )

    canonical = dict(resources)
    if canonical.get("endpoint_created") is True:
        _positive_integer(
            draft.get("endpoint_id"),
            field="draft.endpoint_id",
            journey_id=journey_id,
        )
        canonical.pop("endpoint_name", None)
    elif "endpoint_name" in canonical and draft.get("endpoint_id") is not None:
        raise ValueError(
            f"Onboarding journey {journey_id} has an endpoint name checkpoint "
            "without the endpoint creation marker"
        )

    if canonical.get("account_id") is not None:
        canonical.pop("rgw_account_id", None)
        canonical.pop("account_name", None)
    elif "account_name" in canonical and "rgw_account_id" not in canonical:
        raise ValueError(
            f"Onboarding journey {journey_id} account_name requires rgw_account_id"
        )

    return canonical


def upgrade() -> None:
    bind = op.get_bind()
    journeys = sa.table(
        "onboarding_journeys",
        sa.column("id", sa.String()),
        sa.column("draft", sa.JSON()),
        sa.column("resources", sa.JSON()),
    )
    rows = bind.execute(
        sa.select(journeys.c.id, journeys.c.draft, journeys.c.resources)
    ).mappings().all()
    for row in rows:
        canonical = _canonical_resources(row["id"], row["draft"], row["resources"])
        if canonical == row["resources"]:
            continue
        bind.execute(
            journeys.update()
            .where(journeys.c.id == row["id"])
            .values(resources=canonical)
        )


def downgrade() -> None:
    # Removed checkpoint names are derivable from canonical endpoint/account
    # rows and are not required by the 0260 runtime contract.
    pass
