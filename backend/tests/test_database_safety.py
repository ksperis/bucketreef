# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
import sqlite3
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import DatabaseError
from starlette.requests import Request

from app import main
from app.core.config import DEFAULT_SQLITE_DB_PATH, Settings
from app.core.database import (
    _SQLITE_BUSY_TIMEOUT_MS,
    _configure_sqlite_connection,
    is_sqlite_malformed_database_error,
    sqlite_integrity_status,
)


def _request(path: str = "/api/migrations/retry") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": [],
            "server": ("testserver", 80),
            "client": ("testclient", 12345),
        }
    )


def test_settings_normalize_relative_sqlite_database_url():
    settings = Settings(database_url="sqlite:///./app.db")

    assert settings.database_url == f"sqlite:///{DEFAULT_SQLITE_DB_PATH.resolve().as_posix()}"


def test_settings_keep_absolute_sqlite_database_url(tmp_path):
    db_path = tmp_path / "custom.db"
    settings = Settings(database_url=f"sqlite:///{db_path.as_posix()}")

    assert settings.database_url == f"sqlite:///{db_path.as_posix()}"


def test_settings_keep_sqlite_memory_database_url():
    settings = Settings(database_url="sqlite:///:memory:")

    assert settings.database_url == "sqlite:///:memory:"


def test_lifespan_runs_configuration_security_checks_before_database_initialization(monkeypatch):
    events: list[str] = []

    monkeypatch.setattr(main, "settings", SimpleNamespace(bucket_migration_worker_enabled=False))
    monkeypatch.setattr(main, "_run_pre_database_startup_checks", lambda: events.append("pre-database"))
    monkeypatch.setattr(main, "init_db", lambda *_args: events.append("init-db"))
    monkeypatch.setattr(main, "_run_startup_deployment_checks", lambda: events.append("post-database"))

    async def exercise_lifespan() -> None:
        async with main.lifespan(main.app):
            events.append("serving")

    asyncio.run(exercise_lifespan())

    assert events == ["pre-database", "init-db", "post-database", "serving"]


def test_configure_sqlite_connection_applies_safe_pragmas():
    connection = sqlite3.connect(":memory:")
    try:
        _configure_sqlite_connection(connection, None)
        cursor = connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys")
            assert cursor.fetchone()[0] == 1
            cursor.execute("PRAGMA busy_timeout")
            assert cursor.fetchone()[0] == _SQLITE_BUSY_TIMEOUT_MS
            cursor.execute("PRAGMA synchronous")
            assert cursor.fetchone()[0] == 2
        finally:
            cursor.close()
    finally:
        connection.close()


def test_is_sqlite_malformed_database_error_detects_sqlalchemy_database_error():
    exc = DatabaseError(
        "SELECT 1",
        (1,),
        sqlite3.DatabaseError("database disk image is malformed"),
    )

    assert is_sqlite_malformed_database_error(exc) is True


def test_handle_database_errors_returns_actionable_response_for_sqlite_corruption():
    exc = DatabaseError(
        "SELECT 1",
        (1,),
        sqlite3.DatabaseError("database disk image is malformed"),
    )

    response = asyncio.run(main.handle_database_errors(_request(), exc))

    assert response.status_code == 503
    assert b"SQLite database corruption detected" in response.body


def test_sqlite_integrity_status_reports_corrupted_file(tmp_path):
    db_path = tmp_path / "corrupted.db"
    db_path.write_bytes(b"this is not a sqlite database")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    try:
        ok, details = sqlite_integrity_status(engine)
    finally:
        engine.dispose()

    assert ok is False
    assert details


def test_sqlite_integrity_status_reports_readonly_access_before_wal_setup(tmp_path):
    db_path = tmp_path / "readonly.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE existing_data (id INTEGER)")
    engine = create_engine(f"sqlite:///file:{db_path}?mode=ro&uri=true")
    event.listen(engine, "connect", _configure_sqlite_connection)
    try:
        with pytest.raises(RuntimeError, match="SQLite database is read-only") as raised:
            sqlite_integrity_status(engine)
        assert "10001:10001" in str(raised.value)
        assert "restore or rebuild" not in str(raised.value)
    finally:
        engine.dispose()
