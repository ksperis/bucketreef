# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Enforce canonical external identity provider/issuer semantics.

Revision ID: 0224_external_identity_provider_invariants
Revises: 0223_ldap_import_search_filter
Create Date: 2026-11-02
"""

import re

from alembic import op
import sqlalchemy as sa


revision = "0224_external_identity_provider_invariants"
down_revision = "0223_ldap_import_search_filter"
branch_labels = None
depends_on = None


_TABLE_CONSTRAINTS = {
    "external_identities": "ck_external_identity_provider_issuer",
    "external_identity_link_requests": "ck_external_link_request_provider_issuer",
    "external_identity_link_attempts": "ck_external_link_attempt_provider_issuer",
}

_IDENTITY_KEY_TABLES = {
    "external_identities",
    "external_identity_link_requests",
}

_PROVIDER_ID_PATTERN = re.compile(r"^[a-z0-9_-]+$")

_PROVIDER_ISSUER_CHECK = (
    "provider_id = lower(trim(provider_id)) AND length(provider_id) > 0 AND ("
    "(provider_type = 'oidc' AND issuer IS NOT NULL AND length(issuer) > 0 "
    "AND issuer = trim(issuer) AND issuer = rtrim(issuer, '/')) OR "
    "(provider_type = 'ldap' AND issuer IS NULL))"
)


def _canonicalize_and_validate(bind, table_name: str) -> None:
    rows = bind.execute(
        sa.text(
            f"SELECT id, provider_type, provider_id, issuer, subject FROM {table_name}"
        )
    ).mappings().all()
    canonical_rows: list[tuple[str, str, str, str | None]] = []
    seen_identity_keys: dict[tuple[str, str, object], str] = {}

    for row in rows:
        provider_type = str(row["provider_type"] or "").strip().lower()
        provider_id = str(row["provider_id"] or "").strip().lower()
        if provider_type not in {"oidc", "ldap"}:
            raise RuntimeError(
                f"Cannot enforce external identity provider invariant on {table_name}: "
                f"row {row['id']!r} has unsupported provider_type {row['provider_type']!r}"
            )
        if not _PROVIDER_ID_PATTERN.fullmatch(provider_id):
            raise RuntimeError(
                f"Cannot enforce external identity provider invariant on {table_name}: "
                f"row {row['id']!r} has invalid provider_id {row['provider_id']!r}"
            )

        if provider_type == "oidc":
            issuer = str(row["issuer"] or "").strip().rstrip("/")
            if not issuer:
                raise RuntimeError(
                    f"Cannot enforce external identity provider invariant on {table_name}: "
                    f"row {row['id']!r} has no OIDC issuer"
                )
        else:
            issuer = None

        if table_name in _IDENTITY_KEY_TABLES:
            identity_scope = issuer if provider_type == "oidc" else provider_id
            identity_key = (provider_type, identity_scope, row["subject"])
            duplicate_id = seen_identity_keys.get(identity_key)
            if duplicate_id is not None:
                raise RuntimeError(
                    f"Cannot canonicalize external identity key on {table_name}: "
                    f"rows {duplicate_id!r} and {row['id']!r} would collide"
                )
            seen_identity_keys[identity_key] = str(row["id"])

        canonical_rows.append((str(row["id"]), provider_type, provider_id, issuer))

    for row_id, provider_type, provider_id, issuer in canonical_rows:
        bind.execute(
            sa.text(
                f"UPDATE {table_name} "
                "SET provider_type = :provider_type, provider_id = :provider_id, issuer = :issuer "
                "WHERE id = :id"
            ),
            {
                "id": row_id,
                "provider_type": provider_type,
                "provider_id": provider_id,
                "issuer": issuer,
            },
        )


def upgrade() -> None:
    bind = op.get_bind()
    for table_name, constraint_name in _TABLE_CONSTRAINTS.items():
        _canonicalize_and_validate(bind, table_name)
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.create_check_constraint(constraint_name, _PROVIDER_ISSUER_CHECK)


def downgrade() -> None:
    for table_name, constraint_name in reversed(tuple(_TABLE_CONSTRAINTS.items())):
        with op.batch_alter_table(table_name, schema=None) as batch_op:
            batch_op.drop_constraint(constraint_name, type_="check")
