# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

from app.db import Base
from scripts.generate_database_schema_docs import (
    CHARTDB_PATH,
    DOMAINS,
    REPOSITORY_ROOT,
    chartdb_document,
    expected_sources,
    obsolete_paths,
)


def test_database_schema_documentation_matches_sqlalchemy_metadata():
    stale = [
        path.relative_to(REPOSITORY_ROOT).as_posix()
        for path, expected in expected_sources().items()
        if not path.is_file() or path.read_text(encoding="utf-8") != expected
    ]

    assert stale == [], (
        "Regenerate database schema documentation with "
        "backend/.venv/bin/python backend/scripts/generate_database_schema_docs.py; "
        f"stale files: {stale}"
    )


def test_database_schema_documentation_has_no_obsolete_d2_outputs():
    assert [path for path in obsolete_paths() if path.exists()] == []


def test_chartdb_document_covers_metadata_and_domains():
    document = chartdb_document()
    table_names = {table["name"] for table in document["tables"]}
    assert table_names == set(Base.metadata.tables)
    assert {area["name"] for area in document["areas"]} == {
        domain.name for domain in DOMAINS
    }
    assert all(table["parentAreaId"] for table in document["tables"])

    expected_foreign_keys = sum(
        len(column.foreign_keys)
        for table in Base.metadata.tables.values()
        for column in table.columns
    )
    assert len(document["relationships"]) == expected_foreign_keys

    committed = json.loads(CHARTDB_PATH.read_text(encoding="utf-8"))
    assert committed == document
