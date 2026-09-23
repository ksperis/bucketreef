# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Column, MetaData, PrimaryKeyConstraint, String, Table, inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import is_postgresql_url, is_sqlite_url, sqlite_integrity_status
from app.db import Base
from app.services.storage_endpoints_service import StorageEndpointsService


settings = get_settings()
logger = logging.getLogger(__name__)
_POSTGRES_STARTUP_LOCK_ID = 2_026_070_300_001
_ALEMBIC_VERSION_TABLE = "alembic_version"
_POSTGRES_ALEMBIC_VERSION_LENGTH = 255


def _alembic_config() -> Config:
    base_dir = Path(__file__).resolve().parents[2]
    config = Config(str(base_dir / "alembic.ini"))
    config.set_main_option("script_location", str(base_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    config.attributes["configure_logger"] = False
    return config


@contextmanager
def _postgres_startup_lock(engine):
    if not is_postgresql_url(str(engine.url)):
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


def _create_postgresql_alembic_version_table(connection) -> None:
    if connection.dialect.name != "postgresql":
        return
    metadata = MetaData()
    Table(
        _ALEMBIC_VERSION_TABLE,
        metadata,
        Column("version_num", String(length=_POSTGRES_ALEMBIC_VERSION_LENGTH), nullable=False),
        PrimaryKeyConstraint("version_num", name="alembic_version_pkc"),
    ).create(connection)


def _sqlite_foreign_key_violations(connection) -> list[tuple]:
    return list(connection.exec_driver_sql("PRAGMA foreign_key_check").all())


def _upgrade_sqlite_schema(connection, config: Config) -> None:
    if connection.in_transaction():
        connection.rollback()

    dbapi_connection = connection.connection.driver_connection
    foreign_keys_enabled = bool(
        dbapi_connection.execute("PRAGMA foreign_keys").fetchone()[0]
    )
    if foreign_keys_enabled:
        dbapi_connection.execute("PRAGMA foreign_keys = OFF")
        if dbapi_connection.execute("PRAGMA foreign_keys").fetchone()[0] != 0:
            raise RuntimeError("Could not disable SQLite foreign key checks for schema migration")

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
            dbapi_connection.execute("PRAGMA foreign_keys = ON")
            if dbapi_connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                raise RuntimeError("Could not restore SQLite foreign key checks after schema migration")


def _initialize_or_upgrade_schema(engine) -> None:
    config = _alembic_config()
    connection_context = engine.connect() if engine.dialect.name == "sqlite" else engine.begin()
    with connection_context as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        view_names = set(inspector.get_view_names())

        if not table_names and not view_names:
            Base.metadata.create_all(bind=connection)
            _create_postgresql_alembic_version_table(connection)
            config.attributes["connection"] = connection
            command.stamp(config, "head")
            if connection.dialect.name == "sqlite" and connection.in_transaction():
                connection.commit()
            logger.info(
                "Bootstrapped empty database from SQLAlchemy metadata and stamped Alembic head"
            )
            return

        if _ALEMBIC_VERSION_TABLE not in table_names:
            raise RuntimeError(
                "Database is not empty and has no alembic_version table. "
                "Refusing to create or stamp a potentially unmanaged or partially initialized schema."
            )

        if connection.dialect.name == "sqlite":
            _upgrade_sqlite_schema(connection, config)
            return

        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def _init_db_locked(engine, session_factory) -> None:
    integrity_ok, integrity_details = sqlite_integrity_status(engine)
    if is_sqlite_url(settings.database_url) and not integrity_ok:
        raise RuntimeError(
            "SQLite database integrity check failed before startup. "
            "Stop the backend, back up the database files, run `sqlite3 <db> 'PRAGMA integrity_check;'`, "
            f"then restore or rebuild the database before retrying. Details: {integrity_details}"
        )
    _initialize_or_upgrade_schema(engine)
    integrity_ok, integrity_details = sqlite_integrity_status(engine)
    if is_sqlite_url(settings.database_url) and not integrity_ok:
        raise RuntimeError(
            "SQLite database integrity check failed after migrations. "
            "Stop the backend, back up the database files, run `sqlite3 <db> 'PRAGMA integrity_check;'`, "
            f"then restore or rebuild the database before retrying. Details: {integrity_details}"
        )
    db: Session = session_factory()
    try:
        from app.services.auth_session_service import AuthSessionService

        expired_sessions = AuthSessionService(db).cleanup_expired()
        if expired_sessions:
            logger.info("Revoked %s expired authentication session row(s) during startup", expired_sessions)
        # Ensure env-managed endpoints or default endpoint are registered
        storage_service = StorageEndpointsService(db)
        storage_service.sync_env_endpoints()
        if not storage_service.env_endpoints_locked():
            storage_service.ensure_default_endpoint()
    finally:
        db.close()


def init_db(engine, session_factory) -> None:
    with _postgres_startup_lock(engine):
        _init_db_locked(engine, session_factory)
