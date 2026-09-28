# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persist migration preparation and independent cleanup operations."""
from alembic import op
import sqlalchemy as sa
from app.db.utc_datetime import UTCDateTime

revision = "0135_bucket_migration_workflow"
down_revision = "0134_portal_collaborator_delegation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    active = connection.execute(
        sa.text(
            "SELECT COUNT(*) FROM bucket_migrations WHERE status IN ('queued','running','pause_requested','paused','awaiting_cutover','cancel_requested')"
        )
    ).scalar()
    unresolved_protection = connection.execute(
        sa.text(
            "SELECT COUNT(*) FROM bucket_migration_items i JOIN bucket_migrations m ON m.id=i.migration_id WHERE i.target_lock_applied IS TRUE OR (i.read_only_applied IS TRUE AND m.status != 'completed')"
        )
    ).scalar()
    if active or unresolved_protection:
        raise RuntimeError(
            "Finish or stop existing bucket migrations and verify protection restoration before upgrading. Migration history will not be replayed."
        )
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(
            sa.Column(
                "workflow_version", sa.Integer(), nullable=False, server_default="2"
            )
        )
        batch.add_column(
            sa.Column(
                "configuration_revision",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch.add_column(sa.Column("checked_revision", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column(
                "preparation_status",
                sa.String(),
                nullable=False,
                server_default="unverified",
            )
        )
        batch.add_column(
            sa.Column(
                "preparation_active_checks",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column(
                "preparation_completed_items",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column("preparation_requested_at", UTCDateTime(), nullable=True)
        )
        batch.add_column(sa.Column("maintenance_operation", sa.String(), nullable=True))
        batch.add_column(
            sa.Column(
                "maintenance_status", sa.String(), nullable=False, server_default="idle"
            )
        )
        batch.add_column(sa.Column("maintenance_error", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("maintenance_requested_by_user_id", sa.Integer(), nullable=True)
        )
        batch.create_foreign_key(
            "fk_bucket_migrations_maintenance_user",
            "users",
            ["maintenance_requested_by_user_id"],
            ["id"],
        )
        batch.create_index(
            "ix_bucket_migrations_preparation_status", ["preparation_status"]
        )
        batch.alter_column("mode", existing_type=sa.String(), server_default="pre_sync")
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.add_column(
            sa.Column(
                "target_created_by_migration",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column("preparation_effects_json", sa.Text(), nullable=True)
        )
        batch.add_column(
            sa.Column(
                "source_deleted", sa.Boolean(), nullable=False, server_default="0"
            )
        )
        batch.add_column(
            sa.Column(
                "cleanup_status", sa.String(), nullable=False, server_default="idle"
            )
        )
        batch.add_column(sa.Column("cleanup_error", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("cleanup_verification_json", sa.Text(), nullable=True)
        )
    connection.execute(
        sa.text(
            "UPDATE bucket_migrations SET workflow_version=1 WHERE status != 'draft'"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE bucket_migrations SET preparation_status='stale', precheck_status='pending', precheck_report_json=NULL, precheck_checked_at=NULL, delete_source=FALSE WHERE status='draft'"
        )
    )
    connection.execute(
        sa.text(
            "UPDATE bucket_migration_items SET execution_plan_json=NULL WHERE migration_id IN (SELECT id FROM bucket_migrations WHERE status='draft')"
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    busy = connection.execute(
        sa.text(
            "SELECT COUNT(*) FROM bucket_migrations WHERE preparation_status='checking' OR maintenance_status IN ('queued','running') OR status IN ('queued','running','pause_requested','paused','awaiting_cutover','cancel_requested')"
        )
    ).scalar()
    protected = connection.execute(
        sa.text(
            "SELECT COUNT(*) FROM bucket_migration_items WHERE preparation_effects_json IS NOT NULL OR read_only_applied IS TRUE OR target_lock_applied IS TRUE"
        )
    ).scalar()
    if busy or protected:
        raise RuntimeError(
            "Stop operations and restore all protections before downgrading the migration workflow."
        )
    with op.batch_alter_table("bucket_migration_items") as batch:
        for name in (
            "cleanup_verification_json",
            "cleanup_error",
            "cleanup_status",
            "source_deleted",
            "preparation_effects_json",
            "target_created_by_migration",
        ):
            batch.drop_column(name)
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_constraint(
            "fk_bucket_migrations_maintenance_user", type_="foreignkey"
        )
        batch.drop_column("maintenance_requested_by_user_id")
        batch.drop_index("ix_bucket_migrations_preparation_status")
        for name in (
            "maintenance_error",
            "maintenance_status",
            "maintenance_operation",
            "preparation_requested_at",
            "preparation_completed_items",
            "preparation_active_checks",
            "preparation_status",
            "checked_revision",
            "configuration_revision",
            "workflow_version",
        ):
            batch.drop_column(name)
        batch.alter_column("mode", existing_type=sa.String(), server_default="one_shot")
