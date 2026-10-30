# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store OIDC provider lists as structured JSON.

Revision ID: 0203_structure_oidc_provider_lists
Revises: 0202_structure_api_token_scopes
Create Date: 2026-10-30
"""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0203_structure_oidc_provider_lists"
down_revision = "0202_structure_api_token_scopes"
branch_labels = None
depends_on = None


oidc_providers = sa.table(
    "oidc_providers",
    sa.column("id", sa.Integer()),
    sa.column("scopes_json", sa.Text()),
    sa.column("trusted_email_domains_json", sa.Text()),
    sa.column("scopes", sa.JSON()),
    sa.column("trusted_email_domains", sa.JSON()),
)


def _load_scopes(provider_id: int, raw: object) -> list[str]:
    if not isinstance(raw, str):
        raise ValueError(
            f"OIDC provider {provider_id} scopes_json must contain a non-empty JSON array of strings."
        )
    try:
        scopes = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"OIDC provider {provider_id} scopes_json contains invalid JSON."
        ) from exc
    if (
        not isinstance(scopes, list)
        or not scopes
        or any(not isinstance(scope, str) or not scope.strip() for scope in scopes)
    ):
        raise ValueError(
            f"OIDC provider {provider_id} scopes_json must contain a non-empty JSON array of strings."
        )
    return [scope.strip() for scope in scopes]


def _load_domains(provider_id: int, raw: object) -> list[str]:
    if not isinstance(raw, str):
        raise ValueError(
            f"OIDC provider {provider_id} trusted_email_domains_json must contain a JSON array of strings."
        )
    try:
        domains = json.loads(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"OIDC provider {provider_id} trusted_email_domains_json contains invalid JSON."
        ) from exc
    if not isinstance(domains, list) or any(
        not isinstance(domain, str) for domain in domains
    ):
        raise ValueError(
            f"OIDC provider {provider_id} trusted_email_domains_json must contain a JSON array of strings."
        )
    return [domain for domain in domains if domain]


def upgrade() -> None:
    with op.batch_alter_table("oidc_providers") as batch_op:
        batch_op.add_column(sa.Column("scopes", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column("trusted_email_domains", sa.JSON(), nullable=True)
        )

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            oidc_providers.c.id,
            oidc_providers.c.scopes_json,
            oidc_providers.c.trusted_email_domains_json,
        )
    ).all()
    for row in rows:
        bind.execute(
            oidc_providers.update()
            .where(oidc_providers.c.id == row.id)
            .values(
                scopes=_load_scopes(row.id, row.scopes_json),
                trusted_email_domains=_load_domains(
                    row.id,
                    row.trusted_email_domains_json,
                ),
            )
        )

    with op.batch_alter_table("oidc_providers") as batch_op:
        batch_op.alter_column(
            "scopes",
            existing_type=sa.JSON(),
            nullable=False,
            server_default='["openid","email","profile"]',
        )
        batch_op.alter_column(
            "trusted_email_domains",
            existing_type=sa.JSON(),
            nullable=False,
            server_default="[]",
        )
        batch_op.drop_column("scopes_json")
        batch_op.drop_column("trusted_email_domains_json")


def downgrade() -> None:
    with op.batch_alter_table("oidc_providers") as batch_op:
        batch_op.add_column(
            sa.Column("scopes_json", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("trusted_email_domains_json", sa.Text(), nullable=True)
        )

    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            oidc_providers.c.id,
            oidc_providers.c.scopes,
            oidc_providers.c.trusted_email_domains,
        )
    ).all()
    for row in rows:
        bind.execute(
            oidc_providers.update()
            .where(oidc_providers.c.id == row.id)
            .values(
                scopes_json=json.dumps(
                    row.scopes,
                    ensure_ascii=True,
                    separators=(",", ":"),
                ),
                trusted_email_domains_json=json.dumps(
                    row.trusted_email_domains,
                    ensure_ascii=True,
                    separators=(",", ":"),
                ),
            )
        )

    with op.batch_alter_table("oidc_providers") as batch_op:
        batch_op.alter_column(
            "scopes_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default='["openid","email","profile"]',
        )
        batch_op.alter_column(
            "trusted_email_domains_json",
            existing_type=sa.Text(),
            nullable=False,
            server_default="[]",
        )
        batch_op.drop_column("scopes")
        batch_op.drop_column("trusted_email_domains")
