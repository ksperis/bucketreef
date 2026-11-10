# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
from contextlib import nullcontext
from datetime import datetime, timezone
import sqlite3
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import DatabaseError, OperationalError
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app import main
from app.core.config import DEFAULT_SQLITE_DB_PATH, Settings
from app.core.database import (
    _SQLITE_BUSY_TIMEOUT_MS,
    configure_sqlite_connection,
    is_sqlite_busy_error,
    is_sqlite_malformed_database_error,
    sqlite_integrity_status,
)
from app.core import db_transactions
from app.core.db_transactions import run_db_unit_with_sqlite_retry, run_replayable_db_unit
from app.core.sqlite import begin_sqlite_transaction, configure_sqlite_adapters
from app.db import User


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

    monkeypatch.setattr(
        main,
        "settings",
        SimpleNamespace(
            bucket_migration_worker_enabled=False,
            webhook_worker_enabled=False,
        ),
    )
    monkeypatch.setattr(main, "_run_pre_database_startup_checks", lambda: events.append("pre-database"))
    monkeypatch.setattr(main, "init_db", lambda *_args: events.append("init-db"))
    monkeypatch.setattr(main, "_run_startup_deployment_checks", lambda: events.append("post-database"))

    async def exercise_lifespan() -> None:
        async with main.lifespan(main.app):
            events.append("serving")

    asyncio.run(exercise_lifespan())

    assert events == ["pre-database", "init-db", "post-database", "serving"]


def test_startup_deployment_checks_propagate_invalid_app_settings(monkeypatch):
    db = object()

    monkeypatch.setattr(main, "SessionLocal", lambda: nullcontext(db))

    def fail_load(actual_db):
        assert actual_db is db
        raise ValueError("invalid persisted application settings")

    monkeypatch.setattr(main, "load_app_settings_for_db", fail_load)

    with pytest.raises(ValueError, match="invalid persisted application settings"):
        main._run_startup_deployment_checks()


def test_configure_sqlite_connection_applies_safe_pragmas():
    connection = sqlite3.connect(":memory:")
    try:
        configure_sqlite_connection(connection, None)
        assert connection.isolation_level is None
        assert connection.in_transaction is False
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


def test_sqlite_savepoint_rolls_back_with_outer_transaction():
    engine = create_engine("sqlite:///:memory:", future=True)
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE nested_tx_test (id INTEGER PRIMARY KEY)")

        SessionLocal = sessionmaker(bind=engine, future=True)
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
            driver_connection = db.connection().connection.driver_connection
            assert driver_connection.in_transaction is True
            with db.begin_nested():
                db.execute(text("INSERT INTO nested_tx_test (id) VALUES (1)"))
            db.rollback()

        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT COUNT(*) FROM nested_tx_test").scalar_one() == 0
    finally:
        engine.dispose()


def test_configure_sqlite_adapters_preserves_datetime_representation():
    configure_sqlite_adapters()
    value = datetime(2026, 10, 31, 13, 28, 24, 423787, tzinfo=timezone.utc)
    with sqlite3.connect(":memory:") as connection:
        stored = connection.execute("SELECT ?", (value,)).fetchone()[0]

    assert stored == value.isoformat(" ")


def test_is_sqlite_malformed_database_error_detects_sqlalchemy_database_error():
    exc = DatabaseError(
        "SELECT 1",
        (1,),
        sqlite3.DatabaseError("database disk image is malformed"),
    )

    assert is_sqlite_malformed_database_error(exc) is True


def test_is_sqlite_busy_error_detects_sqlalchemy_database_error():
    exc = DatabaseError(
        "UPDATE auth_sessions SET last_activity_at = ?",
        ("2026-11-09",),
        sqlite3.OperationalError("database is locked"),
    )
    exc.orig.sqlite_errorcode = sqlite3.SQLITE_BUSY

    assert is_sqlite_busy_error(exc) is True


def test_sqlite_busy_snapshot_replays_complete_db_unit(tmp_path, monkeypatch):
    db_path = tmp_path / "busy-snapshot.db"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    observed_codes: list[int | None] = []
    original_detector = db_transactions.is_sqlite_busy_error

    def record_busy_code(exc: BaseException) -> bool:
        observed_codes.append(getattr(getattr(exc, "orig", None), "sqlite_errorcode", None))
        return original_detector(exc)

    monkeypatch.setattr(db_transactions, "is_sqlite_busy_error", record_busy_code)
    SessionLocal = sessionmaker(bind=engine, future=True)
    attempts = 0
    rollbacks = 0
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE busy_test (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)")
            connection.exec_driver_sql("INSERT INTO busy_test (id, value) VALUES (1, 0)")

        with SessionLocal() as target:
            original_rollback = target.rollback

            def rollback() -> None:
                nonlocal rollbacks
                rollbacks += 1
                original_rollback()

            monkeypatch.setattr(target, "rollback", rollback)

            def operation() -> int:
                nonlocal attempts
                attempts += 1
                current = target.execute(text("SELECT value FROM busy_test WHERE id = 1")).scalar_one()
                if attempts == 1:
                    with SessionLocal() as writer:
                        writer.execute(text("UPDATE busy_test SET value = value + 1 WHERE id = 1"))
                        writer.commit()
                target.execute(
                    text("UPDATE busy_test SET value = :value WHERE id = 1"),
                    {"value": current + 10},
                )
                target.commit()
                return current + 10

            assert run_db_unit_with_sqlite_retry(target, operation, retry_delays=(0.0,)) == 11

        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT value FROM busy_test WHERE id = 1").scalar_one() == 11
        assert attempts == 2
        assert rollbacks == 1
        assert observed_codes == [sqlite3.SQLITE_BUSY_SNAPSHOT]
    finally:
        engine.dispose()


def test_postgresql_db_unit_executes_once_without_sqlite_retry(monkeypatch):
    class FakePostgresSession:
        def __init__(self) -> None:
            self.rollback_calls = 0

        @staticmethod
        def get_bind():
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def rollback(self) -> None:
            self.rollback_calls += 1

    db = FakePostgresSession()
    calls = 0

    def operation() -> str:
        nonlocal calls
        calls += 1
        return "ok"

    monkeypatch.setattr(db_transactions.time, "sleep", lambda _delay: pytest.fail("PostgreSQL must not back off"))

    assert run_db_unit_with_sqlite_retry(db, operation) == "ok"
    assert calls == 1
    assert db.rollback_calls == 0


def test_postgresql_replayable_unit_keeps_caller_session_and_executes_once(monkeypatch):
    class FakePostgresSession:
        def __init__(self) -> None:
            self.commit_calls = 0
            self.rollback_calls = 0

        @staticmethod
        def get_bind():
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def commit(self) -> None:
            self.commit_calls += 1

        def rollback(self) -> None:
            self.rollback_calls += 1

    db = FakePostgresSession()
    seen_sessions: list[object] = []

    def operation(operation_db) -> str:
        seen_sessions.append(operation_db)
        return "ok"

    monkeypatch.setattr(
        db_transactions.time,
        "sleep",
        lambda _delay: pytest.fail("PostgreSQL must not back off"),
    )

    assert run_replayable_db_unit(db, operation) == "ok"
    assert seen_sessions == [db]
    assert db.commit_calls == 1
    assert db.rollback_calls == 0


def test_sqlite_replayable_unit_uses_fresh_session_for_each_retry(tmp_path):
    db_path = tmp_path / "replayable-busy-snapshot.db"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    SessionLocal = sessionmaker(bind=engine, future=True)
    attempts = 0
    attempt_sessions: list[object] = []
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "CREATE TABLE replayable_test (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)"
            )
            connection.exec_driver_sql(
                "INSERT INTO replayable_test (id, value) VALUES (1, 0)"
            )

        with SessionLocal() as request_db:
            # Simulate the request-scoped authentication/lookup snapshot that
            # exists before the isolated write unit starts.
            assert request_db.execute(
                text("SELECT value FROM replayable_test WHERE id = 1")
            ).scalar_one() == 0

            def operation(write_db) -> int:
                nonlocal attempts
                attempts += 1
                # Keep references alive so object IDs cannot be recycled
                # between retry attempts.
                attempt_sessions.append(write_db)
                current = write_db.execute(
                    text("SELECT value FROM replayable_test WHERE id = 1")
                ).scalar_one()
                if attempts == 1:
                    with SessionLocal() as concurrent_writer:
                        concurrent_writer.execute(
                            text("UPDATE replayable_test SET value = value + 1 WHERE id = 1")
                        )
                        concurrent_writer.commit()
                write_db.execute(
                    text("UPDATE replayable_test SET value = :value WHERE id = 1"),
                    {"value": current + 10},
                )
                return current + 10

            assert run_replayable_db_unit(
                request_db,
                operation,
                retry_delays=(0.0,),
            ) == 11

        with engine.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT value FROM replayable_test WHERE id = 1"
            ).scalar_one() == 11
        assert attempts == 2
        assert attempt_sessions[0] is not attempt_sessions[1]
    finally:
        engine.dispose()


def test_sqlite_replayable_unit_rejects_pending_caller_changes(tmp_path):
    db_path = tmp_path / "replayable-pending.db"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    event.listen(engine, "connect", configure_sqlite_connection)
    event.listen(engine, "begin", begin_sqlite_transaction)
    SessionLocal = sessionmaker(bind=engine, future=True)
    try:
        with SessionLocal() as request_db:
            request_db.add(
                User(
                    email="pending@example.test",
                    full_name="Pending",
                    hashed_password="x",
                    is_active=True,
                    role="ui_admin",
                )
            )
            with pytest.raises(RuntimeError, match="require a clean caller session"):
                run_replayable_db_unit(request_db, lambda _write_db: "unexpected")

            assert len(request_db.new) == 1
    finally:
        engine.dispose()


def test_sqlite_db_unit_default_retry_budget_handles_burst_contention(monkeypatch):
    class FakeSQLiteSession:
        def __init__(self) -> None:
            self.rollback_calls = 0

        @staticmethod
        def get_bind():
            return SimpleNamespace(dialect=SimpleNamespace(name="sqlite"))

        def rollback(self) -> None:
            self.rollback_calls += 1

    db = FakeSQLiteSession()
    calls = 0
    delays: list[float] = []

    def operation() -> str:
        nonlocal calls
        calls += 1
        if calls <= 6:
            original = sqlite3.OperationalError("database is locked")
            original.sqlite_errorcode = sqlite3.SQLITE_BUSY
            raise OperationalError("UPDATE", (), original)
        return "ok"

    monkeypatch.setattr(db_transactions.time, "sleep", delays.append)

    assert run_db_unit_with_sqlite_retry(db, operation) == "ok"
    assert calls == 7
    assert db.rollback_calls == 6
    assert delays == [0.025, 0.05, 0.1, 0.25, 0.5, 1.0]


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
    event.listen(engine, "connect", configure_sqlite_connection)
    try:
        with pytest.raises(RuntimeError, match="SQLite database is read-only") as raised:
            sqlite_integrity_status(engine)
        assert "10001:10001" in str(raised.value)
        assert "restore or rebuild" not in str(raised.value)
    finally:
        engine.dispose()
