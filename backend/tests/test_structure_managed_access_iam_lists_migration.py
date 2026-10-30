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


IAM_LIST_COLUMNS = (
    "iam_groups_json",
    "iam_managed_policies_json",
    "iam_inline_policy_names_json",
)


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0210_structure_managed_access_iam_lists.py"
    )
    spec = util.spec_from_file_location(
        "migration_0210_structure_managed_access_iam_lists",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _managed_accesses(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "managed_private_accesses",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        *[sa.Column(name, sa.Text(), nullable=False) for name in IAM_LIST_COLUMNS],
    )


def _row(**overrides):
    values = {
        "id": 1,
        "iam_groups_json": json.dumps(["operators"]),
        "iam_managed_policies_json": json.dumps(["arn:test:readonly"]),
        "iam_inline_policy_names_json": json.dumps(["inline-read"]),
    }
    values.update(overrides)
    return values


def test_migration_materializes_structured_lists_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accesses = _managed_accesses(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(accesses.insert().values(**_row()))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("managed_private_accesses")
        }
        assert "iam_groups" in columns
        assert "iam_groups_json" not in columns
        row = connection.execute(
            sa.text(
                "SELECT iam_groups, iam_managed_policies, iam_inline_policy_names "
                "FROM managed_private_accesses WHERE id = 1"
            )
        ).one()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(row.iam_groups) == ["operators"]
        assert processor(row.iam_managed_policies) == ["arn:test:readonly"]
        assert processor(row.iam_inline_policy_names) == ["inline-read"]

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("managed_private_accesses")
        }
        assert "iam_groups" not in columns
        assert "iam_groups_json" in columns
        restored = connection.execute(
            sa.text(
                "SELECT iam_groups_json, iam_managed_policies_json, "
                "iam_inline_policy_names_json FROM managed_private_accesses WHERE id = 1"
            )
        ).one()
        assert json.loads(restored.iam_groups_json) == ["operators"]
        assert json.loads(restored.iam_managed_policies_json) == ["arn:test:readonly"]
        assert json.loads(restored.iam_inline_policy_names_json) == ["inline-read"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("iam_groups_json", "{"),
        ("iam_groups_json", "{}"),
        ("iam_managed_policies_json", "[1]"),
        ("iam_inline_policy_names_json", '[""]'),
    ],
)
def test_migration_rejects_invalid_lists(monkeypatch, field, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accesses = _managed_accesses(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(accesses.insert().values(**_row(**{field: value})))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Managed private access 1"):
            migration.upgrade()
