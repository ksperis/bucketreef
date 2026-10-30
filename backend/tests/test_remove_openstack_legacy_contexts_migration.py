# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_migration_purges_legacy_contexts_and_drops_compatibility_column(monkeypatch):
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/0198_remove_openstack_legacy_contexts.py"
    )
    spec = util.spec_from_file_location("migration_0198", path)
    migration = util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(migration)

    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    sa.Table(
        "openstack_project_contexts",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("endpoint_id", sa.Integer(), sa.ForeignKey("storage_endpoints.id", ondelete="CASCADE"), nullable=True),
        sa.Column("target_id", sa.String(), nullable=False),
        sa.Column("endpoint_interface", sa.String(), nullable=False),
    )
    sa.Table(
        "openstack_project_credentials",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("context_id", sa.String(), sa.ForeignKey("openstack_project_contexts.id", ondelete="CASCADE"), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO storage_endpoints (id) VALUES (7)"))
        connection.execute(
            sa.text(
                """
                INSERT INTO openstack_project_contexts
                    (id, endpoint_id, target_id, endpoint_interface)
                VALUES
                    ('legacy', 7, 'legacy-storage-endpoint:7', 'legacy'),
                    ('catalog', NULL, 'catalog-target', 'public')
                """
            )
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO openstack_project_credentials (id, context_id)
                VALUES ('legacy-key', 'legacy'), ('catalog-key', 'catalog')
                """
            )
        )

        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )
        migration.upgrade()

        assert connection.execute(
            sa.text("SELECT id FROM openstack_project_contexts ORDER BY id")
        ).scalars().all() == ["catalog"]
        assert connection.execute(
            sa.text("SELECT id FROM openstack_project_credentials ORDER BY id")
        ).scalars().all() == ["catalog-key"]
        assert "endpoint_id" not in {
            column["name"]
            for column in sa.inspect(connection).get_columns("openstack_project_contexts")
        }

        migration.downgrade()
        endpoint_column = next(
            column
            for column in sa.inspect(connection).get_columns("openstack_project_contexts")
            if column["name"] == "endpoint_id"
        )
        assert endpoint_column["nullable"] is True
        assert connection.execute(
            sa.text("SELECT id FROM openstack_project_contexts ORDER BY id")
        ).scalars().all() == ["catalog"]
