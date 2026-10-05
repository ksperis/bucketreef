# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, User, UserRole
from app.main import app
from app.routers import dependencies
from app.services.bucket_listing_cache import invalidate_bucket_listing_cache
from app.services.admin_dashboard_metrics_cache import reset_dashboard_metrics_cache
from app.services.bucket_migration.worker import reset_bucket_migration_worker_for_tests
from app.services.webhook_worker import reset_webhook_delivery_worker_for_tests


@pytest.fixture(scope="session")
def test_engine():
    # Shared in-memory sqlite database for the whole test session.
    return create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


@pytest.fixture
def dashboard_test_engine(tmp_path):
    # Dashboard workers need distinct DB connections. StaticPool shares one
    # SQLite connection across threads and can crash the native sqlite driver.
    engine = create_engine(f"sqlite:///{tmp_path / 'dashboard.db'}", connect_args={"check_same_thread": False})
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(test_engine):
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
def client(db_session, monkeypatch):
    # Route tests must not start probes against the application's real database.
    # Scheduling integration tests explicitly restore the task with a test factory.
    monkeypatch.setattr("app.routers.admin.settings.run_initial_healthchecks", lambda **kwargs: None)
    monkeypatch.setattr("app.routers.admin.storage_endpoints.run_initial_healthchecks", lambda **kwargs: None)

    def override_get_db():
        yield db_session

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
    app.dependency_overrides[dependencies.get_current_super_admin] = override_super_admin
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
def reset_env_managed_storage_endpoints(monkeypatch):
    monkeypatch.setattr(
        "app.services.storage_endpoints_service.settings.env_storage_endpoints",
        None,
        raising=False,
    )


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
