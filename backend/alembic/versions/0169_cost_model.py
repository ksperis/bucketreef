"""Replace Billing pricing configuration with the Cost model.

Revision ID: 0169_cost_model
Revises: 0168_remove_retired_billing_settings
Create Date: 2026-10-20 10:00:00.000000

Daily usage and storage measurements are preserved under Cost table names. The
0.2.16 Billing rate-card/assignment configuration is intentionally discarded:
Cost starts with no global model and no endpoint override after upgrade.
"""
from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa


revision = "0169_cost_model"
down_revision = "0168_remove_retired_billing_settings"
branch_labels = None
depends_on = None


def _create_usage_table(prefix: str) -> None:
    table = f"{prefix}_usage_daily"
    op.create_table(
        table,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("bytes_in", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("bytes_out", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("ops_total", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("ops_breakdown", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("collected_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name=f"uq_{prefix}_usage_daily",
        ),
    )
    op.create_index(f"ix_{prefix}_usage_daily_id", table, ["id"])
    op.create_index(f"ix_{prefix}_usage_daily_day", table, ["day"])
    op.create_index(f"ix_{prefix}_usage_daily_storage_endpoint_id", table, ["storage_endpoint_id"])
    op.create_index(f"ix_{prefix}_usage_daily_s3_account_id", table, ["s3_account_id"])
    op.create_index(f"ix_{prefix}_usage_daily_s3_user_id", table, ["s3_user_id"])
    op.create_index(
        f"ix_{prefix}_usage_daily_endpoint_day_account",
        table,
        ["storage_endpoint_id", "day", "s3_account_id"],
    )
    account_where = sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL")
    op.create_index(
        f"uq_{prefix}_usage_daily_account",
        table,
        ["day", "storage_endpoint_id", "s3_account_id", "source"],
        unique=True,
        postgresql_where=account_where,
        sqlite_where=account_where,
    )
    op.create_index(
        f"ix_{prefix}_usage_daily_endpoint_day_user",
        table,
        ["storage_endpoint_id", "day", "s3_user_id"],
    )
    user_where = sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL")
    op.create_index(
        f"uq_{prefix}_usage_daily_user",
        table,
        ["day", "storage_endpoint_id", "s3_user_id", "source"],
        unique=True,
        postgresql_where=user_where,
        sqlite_where=user_where,
    )


def _create_storage_table(prefix: str) -> None:
    table = f"{prefix}_storage_daily"
    op.create_table(
        table,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("total_bytes", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("total_objects", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("by_bucket", sa.Text(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("collected_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "day",
            "storage_endpoint_id",
            "s3_account_id",
            "s3_user_id",
            "source",
            name=f"uq_{prefix}_storage_daily",
        ),
    )
    op.create_index(f"ix_{prefix}_storage_daily_id", table, ["id"])
    op.create_index(f"ix_{prefix}_storage_daily_day", table, ["day"])
    op.create_index(f"ix_{prefix}_storage_daily_storage_endpoint_id", table, ["storage_endpoint_id"])
    op.create_index(f"ix_{prefix}_storage_daily_s3_account_id", table, ["s3_account_id"])
    op.create_index(f"ix_{prefix}_storage_daily_s3_user_id", table, ["s3_user_id"])
    op.create_index(
        f"ix_{prefix}_storage_daily_endpoint_day_account",
        table,
        ["storage_endpoint_id", "day", "s3_account_id"],
    )
    account_where = sa.text("s3_account_id IS NOT NULL AND s3_user_id IS NULL")
    op.create_index(
        f"uq_{prefix}_storage_daily_account",
        table,
        ["day", "storage_endpoint_id", "s3_account_id", "source"],
        unique=True,
        postgresql_where=account_where,
        sqlite_where=account_where,
    )
    op.create_index(
        f"ix_{prefix}_storage_daily_endpoint_day_user",
        table,
        ["storage_endpoint_id", "day", "s3_user_id"],
    )
    user_where = sa.text("s3_user_id IS NOT NULL AND s3_account_id IS NULL")
    op.create_index(
        f"uq_{prefix}_storage_daily_user",
        table,
        ["day", "storage_endpoint_id", "s3_user_id", "source"],
        unique=True,
        postgresql_where=user_where,
        sqlite_where=user_where,
    )


def _copy_daily(source_prefix: str, target_prefix: str) -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            f"INSERT INTO {target_prefix}_usage_daily "
            "(id, day, storage_endpoint_id, s3_account_id, s3_user_id, bytes_in, bytes_out, "
            "ops_total, ops_breakdown, source, collected_at) "
            f"SELECT id, day, storage_endpoint_id, s3_account_id, s3_user_id, bytes_in, bytes_out, "
            f"ops_total, ops_breakdown, source, collected_at FROM {source_prefix}_usage_daily"
        )
    )
    bind.execute(
        sa.text(
            f"INSERT INTO {target_prefix}_storage_daily "
            "(id, day, storage_endpoint_id, s3_account_id, s3_user_id, total_bytes, total_objects, "
            "by_bucket, source, collected_at) "
            f"SELECT id, day, storage_endpoint_id, s3_account_id, s3_user_id, total_bytes, total_objects, "
            f"by_bucket, source, collected_at FROM {source_prefix}_storage_daily"
        )
    )


def _migrate_feature_setting(source: str, target: str) -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT key, payload_json FROM app_settings")).mappings()
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, ValueError):
            continue
        if not isinstance(payload, dict):
            continue
        general = payload.get("general")
        if not isinstance(general, dict) or source not in general:
            continue
        if target not in general:
            general[target] = general[source]
        general.pop(source, None)
        bind.execute(
            sa.text("UPDATE app_settings SET payload_json = :payload_json WHERE key = :key"),
            {
                "key": row["key"],
                "payload_json": json.dumps(payload, separators=(",", ":")),
            },
        )


def _create_cost_configuration() -> None:
    op.create_table(
        "cost_models",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(), server_default="EUR", nullable=False),
        sa.Column("storage_gb_month_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("egress_gb_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("ingress_gb_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("requests_per_1000_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_cost_models_singleton"),
        sa.CheckConstraint("storage_gb_month_price >= 0", name="ck_cost_models_storage_price_nonnegative"),
        sa.CheckConstraint("egress_gb_price >= 0", name="ck_cost_models_egress_price_nonnegative"),
        sa.CheckConstraint("ingress_gb_price >= 0", name="ck_cost_models_ingress_price_nonnegative"),
        sa.CheckConstraint("requests_per_1000_price >= 0", name="ck_cost_models_requests_price_nonnegative"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "cost_endpoint_overrides",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("storage_gb_month_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("egress_gb_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("ingress_gb_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("requests_per_1000_price", sa.Numeric(12, 6), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "storage_gb_month_price >= 0",
            name="ck_cost_endpoint_overrides_storage_price_nonnegative",
        ),
        sa.CheckConstraint("egress_gb_price >= 0", name="ck_cost_endpoint_overrides_egress_price_nonnegative"),
        sa.CheckConstraint("ingress_gb_price >= 0", name="ck_cost_endpoint_overrides_ingress_price_nonnegative"),
        sa.CheckConstraint(
            "requests_per_1000_price >= 0",
            name="ck_cost_endpoint_overrides_requests_price_nonnegative",
        ),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_endpoint_id", name="uq_cost_endpoint_overrides_endpoint"),
    )
    op.create_index("ix_cost_endpoint_overrides_id", "cost_endpoint_overrides", ["id"])
    op.create_index(
        "ix_cost_endpoint_overrides_storage_endpoint_id",
        "cost_endpoint_overrides",
        ["storage_endpoint_id"],
    )


def _create_legacy_billing_configuration() -> None:
    op.create_table(
        "billing_rate_cards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("currency", sa.String(), server_default="EUR", nullable=False),
        sa.Column("storage_gb_month_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("egress_gb_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("ingress_gb_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("requests_per_1000_price", sa.Numeric(12, 6), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_billing_rate_cards_name"),
    )
    op.create_index("ix_billing_rate_cards_id", "billing_rate_cards", ["id"])
    op.create_index("ix_billing_rate_cards_storage_endpoint_id", "billing_rate_cards", ["storage_endpoint_id"])
    op.create_index(
        "ix_billing_rate_cards_endpoint_effective_window",
        "billing_rate_cards",
        ["storage_endpoint_id", "effective_from", "effective_to"],
    )
    op.create_table(
        "billing_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.Column("rate_card_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["rate_card_id"], ["billing_rate_cards.id"]),
        sa.ForeignKeyConstraint(["s3_account_id"], ["s3_accounts.id"]),
        sa.ForeignKeyConstraint(["s3_user_id"], ["s3_users.id"]),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("id", "rate_card_id", "s3_account_id", "s3_user_id", "storage_endpoint_id"):
        op.create_index(f"ix_billing_assignments_{column}", "billing_assignments", [column])
    op.create_index(
        "ix_billing_assignments_endpoint_account_created",
        "billing_assignments",
        ["storage_endpoint_id", "s3_account_id", "created_at"],
    )
    op.create_index(
        "ix_billing_assignments_endpoint_user_created",
        "billing_assignments",
        ["storage_endpoint_id", "s3_user_id", "created_at"],
    )


def upgrade() -> None:
    _create_usage_table("cost")
    _create_storage_table("cost")
    _copy_daily("billing", "cost")

    op.drop_table("billing_assignments")
    op.drop_table("billing_rate_cards")
    op.drop_table("billing_usage_daily")
    op.drop_table("billing_storage_daily")

    _create_cost_configuration()
    _migrate_feature_setting("billing_enabled", "cost_enabled")


def downgrade() -> None:
    _create_usage_table("billing")
    _create_storage_table("billing")
    _copy_daily("cost", "billing")

    op.drop_table("cost_endpoint_overrides")
    op.drop_table("cost_models")
    op.drop_table("cost_usage_daily")
    op.drop_table("cost_storage_daily")

    _create_legacy_billing_configuration()
    _migrate_feature_setting("cost_enabled", "billing_enabled")
