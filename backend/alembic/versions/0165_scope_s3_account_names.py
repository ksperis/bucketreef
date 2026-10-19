"""Scope S3 account display-name uniqueness by endpoint and RGW tenant."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0165_scope_s3_account_names"
down_revision = "0164_billing_statement_automation"
branch_labels = None
depends_on = None


_SQLITE_NAMING_CONVENTION = {
    "uq": "uq_%(table_name)s_%(column_0_name)s",
}


def _unique_constraint_name(bind, columns: list[str]) -> str | None:
    for constraint in sa.inspect(bind).get_unique_constraints("s3_accounts"):
        if constraint.get("column_names") == columns:
            return constraint.get("name")
    return None


def upgrade() -> None:
    bind = op.get_bind()
    legacy_name = _unique_constraint_name(bind, ["name"])
    batch_kwargs: dict[str, object] = {"schema": None}
    if bind.dialect.name == "sqlite" and legacy_name is None:
        # SQLite preserves the historical column-level UNIQUE constraint
        # without a name. Give reflected constraints deterministic names so
        # Alembic can omit only UNIQUE(name) while recreating the table.
        batch_kwargs["naming_convention"] = _SQLITE_NAMING_CONVENTION
        legacy_name = "uq_s3_accounts_name"
    if legacy_name is None:
        raise RuntimeError("Cannot locate the legacy S3 account name uniqueness constraint")

    with op.batch_alter_table("s3_accounts", **batch_kwargs) as batch:
        batch.drop_constraint(legacy_name, type_="unique")
        batch.create_unique_constraint(
            "uq_s3_accounts_endpoint_tenant_name",
            ["storage_endpoint_id", "rgw_tenant", "name"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    duplicated = bind.execute(
        sa.text(
            "SELECT name FROM s3_accounts "
            "GROUP BY name HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicated:
        raise RuntimeError(
            "Cannot downgrade: S3Account names would become globally non-unique"
        )

    with op.batch_alter_table("s3_accounts", schema=None) as batch:
        batch.drop_constraint(
            "uq_s3_accounts_endpoint_tenant_name",
            type_="unique",
        )
        batch.create_unique_constraint("uq_s3_accounts_name", ["name"])
