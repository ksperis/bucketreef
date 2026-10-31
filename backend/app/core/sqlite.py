# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
import sqlite3


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
