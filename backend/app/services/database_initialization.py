# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app.core.database import sqlite_integrity_status
from app.services.app_settings_service import bootstrap_app_settings_for_db
from app.services.storage_endpoints_service import StorageEndpointsService


logger = logging.getLogger(__name__)
_POSTGRES_STARTUP_LOCK_ID = 2_026_070_300_001
_ALEMBIC_VERSION_TABLE = "alembic_version"


def _alembic_config(database_url: str) -> Config:
    base_dir = Path(__file__).resolve().parents[2]
    config = Config(str(base_dir / "alembic.ini"))
    config.set_main_option("script_location", str(base_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    config.attributes["database_url_override"] = database_url
    config.attributes["configure_logger"] = False
    return config


@contextmanager
def _postgres_startup_lock(engine):
    if engine.dialect.name != "postgresql":
        yield
        return
    with engine.connect() as connection:
        logger.info("Acquiring PostgreSQL startup advisory lock %s", _POSTGRES_STARTUP_LOCK_ID)
        connection.execute(text("SELECT pg_advisory_lock(:lock_id)"), {"lock_id": _POSTGRES_STARTUP_LOCK_ID})
        try:
            yield
        finally:
            connection.execute(text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": _POSTGRES_STARTUP_LOCK_ID})
            logger.info("Released PostgreSQL startup advisory lock %s", _POSTGRES_STARTUP_LOCK_ID)


def _sqlite_foreign_key_violations(connection) -> list[tuple]:
    return list(connection.exec_driver_sql("PRAGMA foreign_key_check").all())


def _set_sqlite_foreign_keys(dbapi_connection, *, enabled: bool) -> None:
    dbapi_connection.execute(f"PRAGMA foreign_keys = {'ON' if enabled else 'OFF'}")
    actual = dbapi_connection.execute("PRAGMA foreign_keys").fetchone()[0]

    if actual != int(enabled):
        action = "restore" if enabled else "disable"
        raise RuntimeError(
            f"Could not {action} SQLite foreign key checks for schema migration"
        )


def _upgrade_sqlite_schema(connection, config: Config) -> None:
    if connection.in_transaction():
        connection.rollback()

    dbapi_connection = connection.connection.driver_connection
    foreign_keys_enabled = bool(
        dbapi_connection.execute("PRAGMA foreign_keys").fetchone()[0]
    )
    if foreign_keys_enabled:
        _set_sqlite_foreign_keys(dbapi_connection, enabled=False)

    try:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        if connection.in_transaction():
            connection.commit()

        violations = _sqlite_foreign_key_violations(connection)
        if connection.in_transaction():
            connection.rollback()
        if violations:
            preview = ", ".join(
                f"{table}(rowid={rowid}, parent={parent}, fk={fk_id})"
                for table, rowid, parent, fk_id in violations[:10]
            )
            suffix = " ..." if len(violations) > 10 else ""
            raise RuntimeError(
                "SQLite foreign key integrity check failed after schema migration: "
                f"{preview}{suffix}"
            )
    finally:
        if connection.in_transaction():
            connection.rollback()
        if foreign_keys_enabled:
            _set_sqlite_foreign_keys(dbapi_connection, enabled=True)


def _initialize_or_upgrade_schema(engine) -> None:
    database_url = engine.url.render_as_string(hide_password=False)
    config = _alembic_config(database_url)
    connection_context = engine.connect() if engine.dialect.name == "sqlite" else engine.begin()
    with connection_context as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        view_names = set(inspector.get_view_names())
        is_empty = not table_names and not view_names

        if not is_empty and _ALEMBIC_VERSION_TABLE not in table_names:
            raise RuntimeError(
                "Database is not empty and has no alembic_version table. "
                "Refusing to create or stamp a potentially unmanaged or partially initialized schema."
            )

        if connection.dialect.name == "sqlite":
            _upgrade_sqlite_schema(connection, config)
        else:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

        if is_empty:
            logger.info("Initialized empty database through Alembic migrations")


def _init_db_locked(engine, session_factory) -> None:
    integrity_ok, integrity_details = sqlite_integrity_status(engine)
    if engine.dialect.name == "sqlite" and not integrity_ok:
        raise RuntimeError(
            "SQLite database integrity check failed before startup. "
            "Stop the backend, back up the database files, run `sqlite3 <db> 'PRAGMA integrity_check;'`, "
            f"then restore or rebuild the database before retrying. Details: {integrity_details}"
        )
    _initialize_or_upgrade_schema(engine)
    integrity_ok, integrity_details = sqlite_integrity_status(engine)
    if engine.dialect.name == "sqlite" and not integrity_ok:
        raise RuntimeError(
            "SQLite database integrity check failed after migrations. "
            "Stop the backend, back up the database files, run `sqlite3 <db> 'PRAGMA integrity_check;'`, "
            f"then restore or rebuild the database before retrying. Details: {integrity_details}"
        )
    db: Session = session_factory()
    try:
        from app.services.auth_session_service import AuthSessionService

        bootstrap_app_settings_for_db(db)
        expired_sessions = AuthSessionService(db).cleanup_expired()
        if expired_sessions:
            logger.info("Revoked %s expired authentication session row(s) during startup", expired_sessions)
        # Bootstrap the optional seed endpoint when the inventory is editable.
        storage_service = StorageEndpointsService(db)
        if not storage_service.deployment_manages_endpoints():
            storage_service.ensure_default_endpoint()
        storage_service.reconcile_persisted_identities()
    finally:
        db.close()


def init_db(engine, session_factory) -> None:
    with _postgres_startup_lock(engine):
        _init_db_locked(engine, session_factory)


def prepare_deployment_database(engine, session_factory) -> None:
    """Prepare the shared schema and settings before starting application runtimes."""
    with _postgres_startup_lock(engine):
        _initialize_or_upgrade_schema(engine)
        with session_factory() as db:
            bootstrap_app_settings_for_db(db)
