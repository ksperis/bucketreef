# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_additive_migration_preserves_existing_resources_and_downgrades(monkeypatch):
    spec = util.spec_from_file_location("migration_0194", Path(__file__).parents[1] / "alembic/versions/0194_openstack_connect.py")
    migration = util.module_from_spec(spec); spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    for name in ("users", "ui_groups"):
        sa.Table(name, metadata, sa.Column("id", sa.Integer(), primary_key=True))
    sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String()),
        sa.Column("endpoint_url", sa.String()),
        sa.Column("region", sa.String()),
    )
    sa.Table("auth_sessions", metadata, sa.Column("id", sa.String(), primary_key=True))
    sa.Table("bucket_migrations", metadata, sa.Column("id", sa.Integer(), primary_key=True), sa.Column("name", sa.String()))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(sa.text("insert into bucket_migrations (id, name) values (1, 'preserved')"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        assert "openstack_project_credentials" in sa.inspect(connection).get_table_names()
        assert "execution_auth_session_id" in {col["name"] for col in sa.inspect(connection).get_columns("bucket_migrations")}
        assert connection.execute(sa.text("select name from bucket_migrations where id=1")).scalar_one() == "preserved"
        assert connection.execute(sa.text("select count(*) from openstack_clouds")).scalar_one() == 0
        migration.downgrade()
        assert not any(name.startswith("openstack_") for name in sa.inspect(connection).get_table_names())
        assert connection.execute(sa.text("select name from bucket_migrations where id=1")).scalar_one() == "preserved"


def test_catalog_migration_downgrade_removes_unrepresentable_catalog_contexts(monkeypatch):
    versions = Path(__file__).parents[1] / "alembic/versions"
    spec_0194 = util.spec_from_file_location("migration_0194_catalog_test", versions / "0194_openstack_connect.py")
    migration_0194 = util.module_from_spec(spec_0194); spec_0194.loader.exec_module(migration_0194)
    spec_0195 = util.spec_from_file_location("migration_0195_catalog_test", versions / "0195_openstack_catalog_targets.py")
    migration_0195 = util.module_from_spec(spec_0195); spec_0195.loader.exec_module(migration_0195)

    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    for name in ("users", "ui_groups"):
        sa.Table(name, metadata, sa.Column("id", sa.Integer(), primary_key=True))
    sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String()),
        sa.Column("endpoint_url", sa.String()),
        sa.Column("region", sa.String()),
    )
    sa.Table("auth_sessions", metadata, sa.Column("id", sa.String(), primary_key=True))
    sa.Table("bucket_migrations", metadata, sa.Column("id", sa.Integer(), primary_key=True))
    metadata.create_all(engine)

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration_0194, "op", operations)
        migration_0194.upgrade()
        monkeypatch.setattr(migration_0195, "op", operations)
        migration_0195.upgrade()

        connection.execute(sa.text("INSERT INTO users (id) VALUES (1)"))
        connection.execute(sa.text(
            "INSERT INTO openstack_clouds "
            "(id, name, auth_url, enabled, allow_password, allow_token, managed_endpoints_only, created_at) "
            "VALUES (1, 'Cloud', 'https://identity.example.test/v3', 1, 1, 1, 0, CURRENT_TIMESTAMP)"
        ))
        connection.execute(sa.text(
            "INSERT INTO openstack_connections "
            "(id, user_id, cloud_id, keystone_user_id, display_name, created_at) "
            "VALUES ('conn', 1, 1, 'keystone-user', 'User', CURRENT_TIMESTAMP)"
        ))
        connection.execute(sa.text(
            "INSERT INTO openstack_project_contexts "
            "(id, connection_id, endpoint_id, project_id, project_name, target_id, region_id, endpoint_url, "
            "endpoint_name, endpoint_interface, service_type) "
            "VALUES ('catalog-context', 'conn', NULL, 'project', 'Project', 'target', 'RegionOne', "
            "'https://s3.example.test', 'S3', 'public', 's3')"
        ))

        migration_0195.downgrade()

        assert connection.execute(
            sa.text("SELECT count(*) FROM openstack_project_contexts WHERE id = 'catalog-context'")
        ).scalar_one() == 0
        endpoint_column = next(
            column for column in sa.inspect(connection).get_columns("openstack_project_contexts")
            if column["name"] == "endpoint_id"
        )
        assert endpoint_column["nullable"] is False
