# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
import sqlite3

from sqlalchemy.orm import Session


def _adapt_datetime(value: datetime) -> str:
    """Preserve sqlite3's historical datetime representation explicitly."""

    return value.isoformat(" ")


def configure_sqlite_adapters() -> None:
    """Install explicit adapters required by BucketReef's SQLite paths.

    Python 3.12 deprecated sqlite3's implicit datetime adapter. Registering the
    same representation ourselves keeps existing databases and untyped SQL
    migration parameters stable without depending on that deprecated default.
    """

    sqlite3.register_adapter(datetime, _adapt_datetime)


def ensure_sqlite_transaction_for_savepoint(db: Session) -> None:
    """Anchor a SQLite SAVEPOINT in a real outer transaction.

    Python 3.11 sqlite3 uses legacy transaction control: a SELECT can start
    SQLAlchemy's logical transaction without issuing BEGIN at the driver level.
    Opening and releasing a SAVEPOINT in that state can make its writes survive
    a later Session.rollback(). Start the physical transaction only for that
    narrow case; PostgreSQL and SQLite transactions already opened by DML are
    left unchanged.
    """

    bind = db.get_bind()
    if bind.dialect.name != "sqlite":
        return
    connection = db.connection()
    driver_connection = connection.connection.driver_connection
    if not driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN")
