# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Represent global OpenStack access with the All users system group."""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "0196_openstack_all_users_group"
down_revision = "0195_openstack_catalog_targets"
branch_labels = None
depends_on = None


ALL_USERS_SYSTEM_KEY = "all_users"
ALL_USERS_NAME = "All users"


def _reserve_all_users_name(bind) -> None:
    rows = bind.execute(sa.text("SELECT id, name FROM ui_groups")).mappings().all()
    taken_names = {str(row["name"]).casefold() for row in rows}
    conflicts = [
        row
        for row in rows
        if str(row["name"]).casefold() == ALL_USERS_NAME.casefold()
    ]
    for row in conflicts:
        suffix = 1
        candidate = f"{ALL_USERS_NAME} (custom)"
        while candidate.casefold() in taken_names:
            suffix += 1
            candidate = f"{ALL_USERS_NAME} (custom {suffix})"
        bind.execute(
            sa.text("UPDATE ui_groups SET name = :name WHERE id = :group_id"),
            {"name": candidate, "group_id": row["id"]},
        )
        taken_names.add(candidate.casefold())


def upgrade() -> None:
    with op.batch_alter_table("ui_groups") as batch:
        batch.add_column(sa.Column("system_key", sa.String(), nullable=True))
        batch.create_unique_constraint("uq_ui_groups_system_key", ["system_key"])

    bind = op.get_bind()
    _reserve_all_users_name(bind)
    now = datetime.now(timezone.utc)
    bind.execute(
        sa.text(
            """
            INSERT INTO ui_groups (name, system_key, description, created_at, updated_at)
            VALUES (:name, :system_key, :description, :created_at, :updated_at)
            """
        ),
        {
            "name": ALL_USERS_NAME,
            "system_key": ALL_USERS_SYSTEM_KEY,
            "description": "Built-in group containing every active BucketReef UI user.",
            "created_at": now,
            "updated_at": now,
        },
    )
    group_id = bind.execute(
        sa.text("SELECT id FROM ui_groups WHERE system_key = :system_key"),
        {"system_key": ALL_USERS_SYSTEM_KEY},
    ).scalar_one()
    bind.execute(
        sa.text(
            """
            INSERT INTO openstack_cloud_groups (cloud_id, group_id)
            SELECT id, :group_id
            FROM openstack_clouds
            WHERE all_users = true
            """
        ),
        {"group_id": group_id},
    )

    with op.batch_alter_table("openstack_clouds") as batch:
        batch.drop_column("all_users")


def downgrade() -> None:
    with op.batch_alter_table("openstack_clouds") as batch:
        batch.add_column(
            sa.Column(
                "all_users",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    bind = op.get_bind()
    group_id = bind.execute(
        sa.text("SELECT id FROM ui_groups WHERE system_key = :system_key"),
        {"system_key": ALL_USERS_SYSTEM_KEY},
    ).scalar_one_or_none()
    if group_id is not None:
        bind.execute(
            sa.text(
                """
                UPDATE openstack_clouds
                SET all_users = true
                WHERE id IN (
                    SELECT cloud_id
                    FROM openstack_cloud_groups
                    WHERE group_id = :group_id
                )
                """
            ),
            {"group_id": group_id},
        )
        bind.execute(
            sa.text("DELETE FROM openstack_cloud_groups WHERE group_id = :group_id"),
            {"group_id": group_id},
        )
        bind.execute(
            sa.text("DELETE FROM ui_groups WHERE id = :group_id"),
            {"group_id": group_id},
        )

    with op.batch_alter_table("ui_groups") as batch:
        batch.drop_constraint("uq_ui_groups_system_key", type_="unique")
        batch.drop_column("system_key")
