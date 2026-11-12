# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json
import uuid

from alembic import command
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.db import StorageEndpoint
from app.utils.storage_endpoint_features import normalize_features
from app.models.deployment_configuration import DeploymentManifest
from app.services.app_settings_service import get_general_feature_locks
from app.services.database_initialization import _alembic_config, prepare_deployment_database
from app.services.deployment_configuration_service import DeploymentConfigurationService
from app.services.deployment_configuration_state import get_deployment_configuration
from test_database_initialization_postgresql import _postgresql_url


def test_migrate_and_apply_shared_deployment_revision():
    database_url = _postgresql_url()
    schema = f"bucketreef_configuration_{uuid.uuid4().hex}"
    administration = sa.create_engine(database_url)
    with administration.begin() as connection:
        connection.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    engine = sa.create_engine(database_url, connect_args={"options": f"-csearch_path={schema}"})
    factory = sessionmaker(bind=engine, autoflush=False)

    try:
        config = _alembic_config(database_url)
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "0270_retained_user_history_foreign_keys")
            connection.execute(sa.text(
                "INSERT INTO storage_endpoints (id, name, endpoint_url, provider, features, is_editable, is_default, identity_namespace, created_at, updated_at) "
                "VALUES (41, 'Original', 'https://original.example.test', 'other', :features, false, true, '00000000000000000000000000000041', now(), now())"
            ), {"features": json.dumps(normalize_features("other", None))})

        prepare_deployment_database(engine, factory)
        with factory() as db:
            assert db.get(StorageEndpoint, 41).deployment_key == "endpoint-41"
            assert get_deployment_configuration(db).storage_endpoints_managed

        manifest = DeploymentManifest(schema_version=1, revision=1, features={"portal_enabled": True}, storage_endpoints=[{
            "key": "endpoint-41", "name": "Renamed", "endpoint_url": "https://new.example.test", "provider": "other",
        }])
        barrier = Barrier(2)

        def publish():
            with factory() as db:
                barrier.wait(timeout=10)
                try:
                    return DeploymentConfigurationService(db).apply(manifest).changed
                except ValueError as exc:
                    assert "operation is running" in str(exc)
                    return False

        with ThreadPoolExecutor(max_workers=2) as executor:
            assert sum(executor.map(lambda _: publish(), range(2))) == 1

        with factory() as db:
            assert db.get(StorageEndpoint, 41).endpoint_url == "https://new.example.test"
            assert get_general_feature_locks(db).portal_enabled.value is True
            assert get_deployment_configuration(db).revision == 1
            invalid = DeploymentManifest(schema_version=1, revision=2, storage_endpoints=[], features={"portal_enabled": False})
            with pytest.raises(ValueError, match="must cover"):
                DeploymentConfigurationService(db).apply(invalid)
            assert get_general_feature_locks(db).portal_enabled.value is True
            assert get_deployment_configuration(db).revision == 1
            release = DeploymentManifest(schema_version=1, revision=2, storage_endpoints=None, features={"portal_enabled": None})
            DeploymentConfigurationService(db).apply(release)
            assert not get_general_feature_locks(db).portal_enabled.forced
            assert db.get(StorageEndpoint, 41).is_editable
    finally:
        engine.dispose()
        with administration.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        administration.dispose()
