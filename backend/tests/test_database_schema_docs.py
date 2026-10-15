# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from scripts.generate_database_schema_docs import REPOSITORY_ROOT, expected_sources


def test_database_schema_documentation_matches_sqlalchemy_metadata():
    stale = [
        path.relative_to(REPOSITORY_ROOT).as_posix()
        for path, expected in expected_sources().items()
        if not path.is_file() or path.read_text(encoding="utf-8") != expected
    ]

    assert stale == [], (
        "Regenerate database schema documentation with "
        "backend/.venv/bin/python backend/scripts/generate_database_schema_docs.py --render; "
        f"stale files: {stale}"
    )
