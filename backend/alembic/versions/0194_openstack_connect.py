# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Optional OpenStack clouds and UI-session-bound credentials."""
from alembic import op
import sqlalchemy as sa
from app.db.utc_datetime import UTCDateTime

revision = "0194_openstack_connect"
down_revision = "0193_remove_unused_quota_alert_state"
branch_labels = None
depends_on = None


def fk(name, target, *, primary=False):
    return sa.Column(name, sa.Integer() if target.split(".")[0] in {"users", "ui_groups", "storage_endpoints", "openstack_clouds"} else sa.String(), sa.ForeignKey(target, ondelete="CASCADE"), primary_key=primary, nullable=False)


def upgrade():
    op.create_table("openstack_clouds", sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True), sa.Column("auth_url", sa.String(), nullable=False),
        sa.Column("config_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("allow_password", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_token", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("default_domain", sa.String()), sa.Column("all_users", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", UTCDateTime(), nullable=False))
    for suffix, column, target in (("endpoints", "endpoint_id", "storage_endpoints.id"), ("users", "user_id", "users.id"), ("groups", "group_id", "ui_groups.id")):
        op.create_table("openstack_cloud_" + suffix, fk("cloud_id", "openstack_clouds.id", primary=True), fk(column, target, primary=True))
    op.create_table("openstack_connections", sa.Column("id", sa.String(), primary_key=True),
        fk("user_id", "users.id"), fk("cloud_id", "openstack_clouds.id"),
        sa.Column("keystone_user_id", sa.String(), nullable=False), sa.Column("display_name", sa.String(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "cloud_id", "keystone_user_id", name="uq_openstack_connection_identity"))
    op.create_table("openstack_sessions", sa.Column("id", sa.String(), primary_key=True),
        fk("connection_id", "openstack_connections.id"), fk("auth_session_id", "auth_sessions.id"),
        sa.Column("token", sa.String()), sa.Column("cloud_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.UniqueConstraint("connection_id", "auth_session_id", name="uq_openstack_ui_session"))
    op.create_table("openstack_project_contexts", sa.Column("id", sa.String(), primary_key=True),
        fk("connection_id", "openstack_connections.id"), fk("endpoint_id", "storage_endpoints.id"),
        sa.Column("project_id", sa.String(), nullable=False), sa.Column("project_name", sa.String(), nullable=False),
        sa.UniqueConstraint("connection_id", "project_id", "endpoint_id", name="uq_openstack_project_endpoint"))
    op.create_table("openstack_project_credentials", sa.Column("id", sa.String(), primary_key=True),
        fk("session_id", "openstack_sessions.id"), fk("context_id", "openstack_project_contexts.id"),
        sa.Column("access_key", sa.String(), nullable=False), sa.Column("secret_key", sa.String()),
        sa.Column("validated_at", UTCDateTime(), nullable=False), sa.Column("expires_at", UTCDateTime(), nullable=False),
        sa.Column("can_manage_iam", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("session_id", "context_id", name="uq_openstack_project_credential"))
    for table, columns in {"openstack_connections": ("user_id", "cloud_id"), "openstack_sessions": ("connection_id", "auth_session_id"), "openstack_project_contexts": ("connection_id",), "openstack_project_credentials": ("session_id", "context_id")}.items():
        for column in columns:
            op.create_index("ix_" + table + "_" + column, table, [column])
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(sa.Column("execution_auth_session_id", sa.String(), nullable=True))
        batch.create_foreign_key("fk_bucket_migration_auth_session", "auth_sessions", ["execution_auth_session_id"], ["id"], ondelete="SET NULL")


def downgrade():
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_constraint("fk_bucket_migration_auth_session", type_="foreignkey")
        batch.drop_column("execution_auth_session_id")
    for table in ("openstack_project_credentials", "openstack_project_contexts", "openstack_sessions", "openstack_connections", "openstack_cloud_groups", "openstack_cloud_users", "openstack_cloud_endpoints", "openstack_clouds"):
        op.drop_table(table)
