# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0158_canonical_connection_rgw_identity.py"
    )
    spec = util.spec_from_file_location(
        "migration_0158_canonical_connection_rgw_identity",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_converts_historical_owner_metadata_once(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    connections = sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("credential_owner_type", sa.String(), nullable=True),
        sa.Column("credential_owner_identifier", sa.String(), nullable=True),
        sa.CheckConstraint(
            "credential_owner_type IS NULL OR "
            "credential_owner_type IN ('iam_user', 'account_user', 's3_user')",
            name="ck_s3_connections_credential_owner_type",
        ),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert(),
            [
                {"id": 1, "credential_owner_type": "s3_user", "credential_owner_identifier": "tenant$user"},
                {"id": 2, "credential_owner_type": "account_user", "credential_owner_identifier": "RGW00000000000000001:alice"},
                {"id": 3, "credential_owner_type": "iam_user", "credential_owner_identifier": "iam:reporter"},
                {"id": 4, "credential_owner_type": "iam_user", "credential_owner_identifier": "rgw00000000000000002:auditor"},
                {"id": 5, "credential_owner_type": "account_user", "credential_owner_identifier": "RGW00000000000000003"},
                {"id": 6, "credential_owner_type": None, "credential_owner_identifier": None},
                {"id": 7, "credential_owner_type": "s3_user", "credential_owner_identifier": "alice"},
                {"id": 8, "credential_owner_type": "s3_user", "credential_owner_identifier": "RGW00000000000000004$legacy-principal"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        inspector = sa.inspect(connection)
        column_names = {column["name"] for column in inspector.get_columns("s3_connections")}
        assert "credential_owner_type" not in column_names
        assert "credential_owner_identifier" not in column_names
        assert {"rgw_user_uid", "rgw_tenant", "rgw_account_id"}.issubset(column_names)
        assert connection.execute(
            sa.text(
                "SELECT id, rgw_user_uid, rgw_tenant, rgw_account_id "
                "FROM s3_connections ORDER BY id"
            )
        ).all() == [
            (1, "user", "tenant", None),
            (2, None, None, "RGW00000000000000001"),
            (3, None, None, None),
            (4, None, None, "RGW00000000000000002"),
            (5, None, None, None),
            (6, None, None, None),
            (7, "alice", "", None),
            (8, None, None, "RGW00000000000000004"),
        ]

        migration.downgrade()
        downgraded = connection.execute(
            sa.text(
                "SELECT id, credential_owner_type, credential_owner_identifier "
                "FROM s3_connections ORDER BY id"
            )
        ).all()
        assert downgraded[0] == (1, "s3_user", "tenant$user")
        assert downgraded[1] == (2, "account_user", "RGW00000000000000001")
        assert downgraded[4] == (5, None, None)
        assert downgraded[6] == (7, "s3_user", "alice")
