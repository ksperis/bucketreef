"""Introduce stable billing rate plans and period-aware assignments."""

from __future__ import annotations

from datetime import date, datetime, timezone

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime


revision = "0159_billing_rate_card_versions"
down_revision = "0158_connection_rgw_identity"
branch_labels = None
depends_on = None


def _month_start(value: date | datetime) -> date:
    candidate = value.date() if isinstance(value, datetime) else value
    return candidate.replace(day=1)


def _plan_id_for(
    bind: sa.Connection,
    plans: sa.TableClause,
    *,
    name: str,
    storage_endpoint_id: int | None,
) -> int:
    predicate = plans.c.storage_endpoint_id == storage_endpoint_id
    if storage_endpoint_id is None:
        predicate = plans.c.storage_endpoint_id.is_(None)
    result = bind.scalar(
        sa.select(plans.c.id).where(
            plans.c.name == name,
            predicate,
        )
    )
    if result is None:
        raise RuntimeError(f"Unable to resolve migrated billing rate plan {name!r}")
    return int(result)


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)

    op.create_table(
        "billing_rate_plans",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(["storage_endpoint_id"], ["storage_endpoints.id"]),
    )
    op.create_index("ix_billing_rate_plans_id", "billing_rate_plans", ["id"])
    op.create_index(
        "ix_billing_rate_plans_storage_endpoint_id",
        "billing_rate_plans",
        ["storage_endpoint_id"],
    )
    op.create_index(
        "uq_billing_rate_plans_global_name",
        "billing_rate_plans",
        ["name"],
        unique=True,
        sqlite_where=sa.text("storage_endpoint_id IS NULL"),
        postgresql_where=sa.text("storage_endpoint_id IS NULL"),
    )
    op.create_index(
        "uq_billing_rate_plans_endpoint_name",
        "billing_rate_plans",
        ["storage_endpoint_id", "name"],
        unique=True,
        sqlite_where=sa.text("storage_endpoint_id IS NOT NULL"),
        postgresql_where=sa.text("storage_endpoint_id IS NOT NULL"),
    )

    with op.batch_alter_table("billing_rate_cards") as batch:
        batch.add_column(sa.Column("rate_plan_id", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column(
                "storage_charge_basis",
                sa.String(),
                nullable=False,
                server_default="actual_usage",
            )
        )

    plans = sa.table(
        "billing_rate_plans",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("storage_endpoint_id", sa.Integer()),
        sa.column("created_at", UTCDateTime()),
        sa.column("updated_at", UTCDateTime()),
    )
    cards = sa.table(
        "billing_rate_cards",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("storage_endpoint_id", sa.Integer()),
        sa.column("effective_from", sa.Date()),
        sa.column("created_at", UTCDateTime()),
        sa.column("updated_at", UTCDateTime()),
        sa.column("rate_plan_id", sa.Integer()),
    )
    existing_cards = bind.execute(
        sa.select(
            cards.c.id,
            cards.c.name,
            cards.c.storage_endpoint_id,
            cards.c.created_at,
            cards.c.updated_at,
        ).order_by(cards.c.id)
    ).mappings().all()
    plan_keys: set[tuple[str, int | None]] = set()
    for row in existing_cards:
        key = (str(row["name"]), row["storage_endpoint_id"])
        if key in plan_keys:
            continue
        plan_keys.add(key)
        bind.execute(
            plans.insert().values(
                name=key[0],
                storage_endpoint_id=key[1],
                created_at=row["created_at"] or now,
                updated_at=row["updated_at"] or row["created_at"] or now,
            )
        )

    for row in existing_cards:
        plan_id = _plan_id_for(
            bind,
            plans,
            name=str(row["name"]),
            storage_endpoint_id=row["storage_endpoint_id"],
        )
        bind.execute(
            cards.update().where(cards.c.id == row["id"]).values(rate_plan_id=plan_id)
        )

    with op.batch_alter_table("billing_assignments") as batch:
        batch.add_column(sa.Column("rate_plan_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("effective_from", sa.Date(), nullable=True))
        batch.add_column(sa.Column("effective_to", sa.Date(), nullable=True))
        batch.add_column(sa.Column("updated_at", UTCDateTime(), nullable=True))

    assignments = sa.table(
        "billing_assignments",
        sa.column("id", sa.Integer()),
        sa.column("rate_card_id", sa.Integer()),
        sa.column("rate_plan_id", sa.Integer()),
        sa.column("effective_from", sa.Date()),
        sa.column("effective_to", sa.Date()),
        sa.column("created_at", UTCDateTime()),
        sa.column("updated_at", UTCDateTime()),
    )
    card_periods = {
        int(row["id"]): (int(row["rate_plan_id"]), row["effective_from"])
        for row in bind.execute(
            sa.select(cards.c.id, cards.c.rate_plan_id, cards.c.effective_from)
        ).mappings()
    }
    existing_assignments = bind.execute(
        sa.select(assignments.c.id, assignments.c.rate_card_id, assignments.c.created_at)
    ).mappings().all()
    for row in existing_assignments:
        migrated = card_periods.get(int(row["rate_card_id"]))
        if migrated is None:
            raise RuntimeError(
                f"Billing assignment {row['id']} references missing rate card {row['rate_card_id']}"
            )
        plan_id, effective_from = migrated
        bind.execute(
            assignments.update()
            .where(assignments.c.id == row["id"])
            .values(
                rate_plan_id=plan_id,
                effective_from=_month_start(effective_from),
                effective_to=None,
                updated_at=row["created_at"] or now,
            )
        )

    with op.batch_alter_table("billing_rate_cards") as batch:
        batch.drop_index("ix_billing_rate_cards_endpoint_effective_window")
        batch.drop_index("ix_billing_rate_cards_storage_endpoint_id")
        batch.drop_constraint("uq_billing_rate_cards_name", type_="unique")
        batch.create_foreign_key(
            "fk_billing_rate_cards_rate_plan_id",
            "billing_rate_plans",
            ["rate_plan_id"],
            ["id"],
        )
        batch.alter_column("rate_plan_id", existing_type=sa.Integer(), nullable=False)
        batch.create_index("ix_billing_rate_cards_rate_plan_id", ["rate_plan_id"])
        batch.create_index(
            "ix_billing_rate_cards_plan_effective_window",
            ["rate_plan_id", "effective_from", "effective_to"],
        )
        batch.create_unique_constraint(
            "uq_billing_rate_cards_plan_effective",
            ["rate_plan_id", "effective_from"],
        )
        batch.create_check_constraint(
            "ck_billing_rate_cards_storage_charge_basis",
            "storage_charge_basis IN ('actual_usage', 'allocated_quota')",
        )
        batch.drop_column("storage_endpoint_id")
        batch.drop_column("name")

    with op.batch_alter_table("billing_assignments") as batch:
        batch.drop_index("ix_billing_assignments_endpoint_account_created")
        batch.drop_index("ix_billing_assignments_endpoint_user_created")
        batch.drop_index("ix_billing_assignments_rate_card_id")
        batch.create_foreign_key(
            "fk_billing_assignments_rate_plan_id",
            "billing_rate_plans",
            ["rate_plan_id"],
            ["id"],
        )
        batch.alter_column("rate_plan_id", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("effective_from", existing_type=sa.Date(), nullable=False)
        batch.alter_column("updated_at", existing_type=UTCDateTime(), nullable=False)
        batch.create_index("ix_billing_assignments_rate_plan_id", ["rate_plan_id"])
        batch.create_index(
            "ix_billing_assignments_endpoint_account_effective",
            ["storage_endpoint_id", "s3_account_id", "effective_from", "effective_to"],
        )
        batch.create_index(
            "ix_billing_assignments_endpoint_user_effective",
            ["storage_endpoint_id", "s3_user_id", "effective_from", "effective_to"],
        )
        batch.drop_column("rate_card_id")


def downgrade() -> None:
    bind = op.get_bind()

    duplicate_versions = bind.execute(
        sa.text(
            "SELECT rate_plan_id FROM billing_rate_cards "
            "GROUP BY rate_plan_id HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    duplicate_names = bind.execute(
        sa.text(
            "SELECT name FROM billing_rate_plans GROUP BY name HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate_versions is not None or duplicate_names is not None:
        raise RuntimeError(
            "Cannot downgrade versioned billing rate plans after multiple versions/scopes exist"
        )

    with op.batch_alter_table("billing_rate_cards") as batch:
        batch.add_column(sa.Column("name", sa.String(), nullable=True))
        batch.add_column(sa.Column("storage_endpoint_id", sa.Integer(), nullable=True))

    plans = sa.table(
        "billing_rate_plans",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("storage_endpoint_id", sa.Integer()),
    )
    cards = sa.table(
        "billing_rate_cards",
        sa.column("id", sa.Integer()),
        sa.column("rate_plan_id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("storage_endpoint_id", sa.Integer()),
    )
    plan_rows = {
        int(row["id"]): row
        for row in bind.execute(sa.select(plans)).mappings()
    }
    card_rows = bind.execute(sa.select(cards.c.id, cards.c.rate_plan_id)).mappings().all()
    card_for_plan: dict[int, int] = {}
    for row in card_rows:
        plan = plan_rows[int(row["rate_plan_id"])]
        card_for_plan[int(row["rate_plan_id"])] = int(row["id"])
        bind.execute(
            cards.update()
            .where(cards.c.id == row["id"])
            .values(
                name=plan["name"],
                storage_endpoint_id=plan["storage_endpoint_id"],
            )
        )

    with op.batch_alter_table("billing_assignments") as batch:
        batch.add_column(sa.Column("rate_card_id", sa.Integer(), nullable=True))

    assignments = sa.table(
        "billing_assignments",
        sa.column("id", sa.Integer()),
        sa.column("rate_plan_id", sa.Integer()),
        sa.column("rate_card_id", sa.Integer()),
    )
    for row in bind.execute(sa.select(assignments.c.id, assignments.c.rate_plan_id)).mappings():
        card_id = card_for_plan.get(int(row["rate_plan_id"]))
        if card_id is None:
            raise RuntimeError(
                f"Cannot downgrade billing assignment {row['id']}: rate plan has no version"
            )
        bind.execute(
            assignments.update()
            .where(assignments.c.id == row["id"])
            .values(rate_card_id=card_id)
        )

    with op.batch_alter_table("billing_assignments") as batch:
        batch.drop_index("ix_billing_assignments_endpoint_account_effective")
        batch.drop_index("ix_billing_assignments_endpoint_user_effective")
        batch.drop_index("ix_billing_assignments_rate_plan_id")
        batch.create_foreign_key(
            "fk_billing_assignments_rate_card_id",
            "billing_rate_cards",
            ["rate_card_id"],
            ["id"],
        )
        batch.alter_column("rate_card_id", existing_type=sa.Integer(), nullable=False)
        batch.create_index("ix_billing_assignments_rate_card_id", ["rate_card_id"])
        batch.create_index(
            "ix_billing_assignments_endpoint_account_created",
            ["storage_endpoint_id", "s3_account_id", "created_at"],
        )
        batch.create_index(
            "ix_billing_assignments_endpoint_user_created",
            ["storage_endpoint_id", "s3_user_id", "created_at"],
        )
        batch.drop_column("updated_at")
        batch.drop_column("effective_to")
        batch.drop_column("effective_from")
        batch.drop_column("rate_plan_id")

    with op.batch_alter_table("billing_rate_cards") as batch:
        batch.drop_index("ix_billing_rate_cards_plan_effective_window")
        batch.drop_index("ix_billing_rate_cards_rate_plan_id")
        batch.drop_constraint("uq_billing_rate_cards_plan_effective", type_="unique")
        batch.drop_constraint("ck_billing_rate_cards_storage_charge_basis", type_="check")
        batch.create_foreign_key(
            "fk_billing_rate_cards_storage_endpoint_id",
            "storage_endpoints",
            ["storage_endpoint_id"],
            ["id"],
        )
        batch.alter_column("name", existing_type=sa.String(), nullable=False)
        batch.create_unique_constraint("uq_billing_rate_cards_name", ["name"])
        batch.create_index(
            "ix_billing_rate_cards_storage_endpoint_id",
            ["storage_endpoint_id"],
        )
        batch.create_index(
            "ix_billing_rate_cards_endpoint_effective_window",
            ["storage_endpoint_id", "effective_from", "effective_to"],
        )
        batch.drop_column("rate_plan_id")
        batch.drop_column("storage_charge_basis")

    op.drop_index("uq_billing_rate_plans_endpoint_name", table_name="billing_rate_plans")
    op.drop_index("uq_billing_rate_plans_global_name", table_name="billing_rate_plans")
    op.drop_index("ix_billing_rate_plans_storage_endpoint_id", table_name="billing_rate_plans")
    op.drop_index("ix_billing_rate_plans_id", table_name="billing_rate_plans")
    op.drop_table("billing_rate_plans")
