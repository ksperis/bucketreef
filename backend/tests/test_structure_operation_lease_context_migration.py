# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0211_structure_operation_lease_context.py"
    )
    spec = util.spec_from_file_location(
        "migration_0211_structure_operation_lease_context",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _operation_leases(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "backend_operation_leases",
        metadata,
        sa.Column("operation_name", sa.String(), primary_key=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )


def test_migration_materializes_structured_context_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    leases = _operation_leases(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            leases.insert(),
            [
                {
                    "operation_name": "bucket-usage-stats:collect",
                    "metadata_json": json.dumps(
                        {"scope": "account:42", "bucket_count": 3}
                    ),
                },
                {
                    "operation_name": "healthchecks:run",
                    "metadata_json": None,
                },
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("backend_operation_leases")
        }
        assert "lease_context" in columns
        assert "metadata_json" not in columns
        rows = connection.execute(
            sa.text(
                "SELECT operation_name, lease_context "
                "FROM backend_operation_leases ORDER BY operation_name"
            )
        ).all()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(rows[0].lease_context) == {
            "scope": "account:42",
            "bucket_count": 3,
        }
        assert processor(rows[1].lease_context) is None

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("backend_operation_leases")
        }
        assert "lease_context" not in columns
        assert "metadata_json" in columns
        restored = connection.execute(
            sa.text(
                "SELECT operation_name, metadata_json "
                "FROM backend_operation_leases ORDER BY operation_name"
            )
        ).all()
        assert json.loads(restored[0].metadata_json) == {
            "scope": "account:42",
            "bucket_count": 3,
        }
        assert restored[1].metadata_json is None


@pytest.mark.parametrize("value", ["{", "[]", '"legacy"', "null"])
def test_migration_rejects_non_object_context(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    leases = _operation_leases(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            leases.insert().values(
                operation_name="healthchecks:run",
                metadata_json=value,
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Backend operation lease healthchecks:run"):
            migration.upgrade()
