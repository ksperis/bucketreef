# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app import main as app_main
from app.core.database import configure_sqlite_connection
from app.core.sqlite import begin_sqlite_transaction
from app.db import Base, User
from app.core.domain_enums import UserRole
from app.main import app
from app.routers import dependencies
from app.services.app_settings_service import (
    bootstrap_app_settings_for_db,
    load_app_settings_for_db,
    save_app_settings_for_db,
)
from app.services.bucket_listing_cache import invalidate_bucket_listing_cache
from app.services.admin_dashboard_metrics_cache import reset_dashboard_metrics_cache
from app.services.bucket_migration.worker import reset_bucket_migration_worker_for_tests
from app.services.webhook_worker import reset_webhook_delivery_worker_for_tests


@pytest.fixture(scope="session")
def test_engine(tmp_path_factory):
    # File-backed SQLite gives concurrent test sessions independent connections,
    # matching the transaction model used by the application runtime.
    database_path = tmp_path_factory.mktemp("bucketreef-tests") / "test.sqlite"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def app_lifespan_test_database(tmp_path_factory):
    database_path = tmp_path_factory.mktemp("bucketreef-lifespan-tests") / "startup.sqlite"
    engine = create_engine(
        f"sqlite:///{database_path}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
        future=True,
    )
    try:
        yield engine, session_factory
    finally:
        engine.dispose()


@pytest.fixture(autouse=True)
def isolate_app_lifespan_database(monkeypatch, app_lifespan_test_database):
    engine, session_factory = app_lifespan_test_database
    monkeypatch.setattr(app_main, "engine", engine)
    monkeypatch.setattr(app_main, "SessionLocal", session_factory)


@pytest.fixture
def dashboard_test_engine(tmp_path):
    # Dashboard workers need distinct DB connections. StaticPool shares one
    # SQLite connection across threads and can crash the native sqlite driver.
    engine = create_engine(f"sqlite:///{tmp_path / 'dashboard.db'}", connect_args={"check_same_thread": False})
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    yield engine
    engine.dispose()


@pytest.fixture
def raw_db_session(test_engine):
    # Full schema reset per test to avoid order-dependent state leaks.
    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def db_session(raw_db_session):
    # Normal runtime tests start after init_db(), which bootstraps app settings.
    bootstrap_app_settings_for_db(raw_db_session)
    # Most functional tests predate the optional resource switches and exercise
    # the historical installation behavior. Migration/fresh-install tests use
    # raw_db_session or model defaults directly and therefore keep the new
    # fresh-install defaults.
    settings = load_app_settings_for_db(raw_db_session)
    settings.general.managed_rgw_accounts_enabled = True
    settings.general.managed_rgw_users_enabled = True
    settings.general.shared_s3_connections_enabled = True
    settings.general.private_s3_connections_enabled = True
    save_app_settings_for_db(raw_db_session, settings)
    return raw_db_session


@pytest.fixture
def client(db_session, monkeypatch):
    # Route tests must not start probes against the application's real database.
    # Scheduling integration tests explicitly restore the task with a test factory.
    monkeypatch.setattr("app.routers.admin.settings.run_initial_healthchecks", lambda **kwargs: None)
    monkeypatch.setattr("app.routers.admin.storage_endpoints.run_initial_healthchecks", lambda **kwargs: None)

    def override_get_db():
        try:
            yield db_session
        finally:
            db_session.rollback()

    def override_super_admin():
        return User(
            id=999,
            email="admin@example.com",
            full_name="Admin",
            hashed_password="x",
            is_active=True,
            role=UserRole.UI_SUPERADMIN.value,
        )

    def override_account_admin():
        return User(
            id=1000,
            email="manager@example.com",
            full_name="Manager",
            hashed_password="x",
            is_active=True,
            role=UserRole.UI_USER.value,
        )

    app.dependency_overrides[dependencies.get_db] = override_get_db
    app.dependency_overrides[dependencies.get_current_ui_admin] = override_super_admin
    app.dependency_overrides[dependencies.get_current_account_admin] = override_account_admin

    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides = {}


@pytest.fixture(autouse=True)
def reset_admin_dashboard_metrics_cache():
    reset_dashboard_metrics_cache()
    yield
    reset_dashboard_metrics_cache()


@pytest.fixture(autouse=True)
def reset_bucket_listing_cache():
    invalidate_bucket_listing_cache()
    try:
        yield
    finally:
        invalidate_bucket_listing_cache()


@pytest.fixture(autouse=True)
def reset_bucket_migration_workers():
    reset_bucket_migration_worker_for_tests()
    reset_webhook_delivery_worker_for_tests()
    try:
        yield
    finally:
        reset_bucket_migration_worker_for_tests()
        reset_webhook_delivery_worker_for_tests()


@pytest.fixture
def public_s3_endpoint_dns(monkeypatch):
    """Keep workspace authorization fixtures independent of process-wide DNS stubs."""
    import ipaddress
    from app.utils import network_targets
    original = network_targets.resolve_hostname_ips
    monkeypatch.setattr(network_targets, "resolve_hostname_ips", lambda host: {
        ipaddress.ip_address("93.184.216.34")
    } if host == "93.184.216.34" else original(host))


@pytest.fixture
def apply_deployment_endpoints(db_session, tmp_path):
    from app.models.deployment_configuration import DeploymentManifest
    from app.services.deployment_configuration_service import DeploymentConfigurationService
    from app.services.storage_endpoints_service import StorageEndpointsService

    revision = 0

    def apply(entries):
        nonlocal revision
        revision += 1
        inventory = []
        for index, source in enumerate(entries):
            entry = dict(source)
            entry.setdefault("key", f"test-{index}")
            credentials = {}
            for kind in ("admin", "runtime", "supervision", "ceph_admin"):
                files = {}
                for name in ("access_key", "secret_key"):
                    value = entry.pop(f"{kind}_{name}", None)
                    if value is not None:
                        path = tmp_path / f"{revision}-{index}-{kind}-{name}"
                        path.write_text(value, encoding="utf-8")
                        files[f"{name}_file"] = path
                if files:
                    credentials[kind] = files
            inventory.append({**entry, "credentials": credentials})
        DeploymentConfigurationService(db_session).apply(DeploymentManifest(
            schema_version=1, revision=revision, storage_endpoints=inventory,
        ))
        return StorageEndpointsService(db_session).query.list_endpoints(include_admin_ops_permissions=False)

    return apply
