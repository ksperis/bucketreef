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
    for name in ("users", "ui_groups", "storage_endpoints"):
        sa.Table(name, metadata, sa.Column("id", sa.Integer(), primary_key=True))
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
