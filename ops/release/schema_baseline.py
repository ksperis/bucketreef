#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe. Licensed under Apache-2.0.
"""Generate or verify reference schema snapshots; never connect to an application DB."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile

from release_notes import ROOT, version_tuple


def requires_baseline(version: str) -> bool:
    major, _minor, patch = version_tuple(version)
    return major == 0 and patch == 1


def baseline_files(root: Path, version: str) -> dict[str, bytes]:
    # Import schema declarations only. No engine, settings or application startup.
    sys.path.insert(0, str(root / "backend"))
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_mock_engine
    from sqlalchemy.schema import CreateIndex
    from app.db import Base

    config = Config()
    config.set_main_option("script_location", str(root / "backend/alembic"))
    head = ScriptDirectory.from_config(config).get_current_head()
    if head is None:
        raise ValueError("A baseline requires exactly one Alembic head")
    files = {}
    for dialect in ("sqlite", "postgresql"):
        statements, indexes = [], []

        def collect(ddl, *args, **kwargs):
            sql = str(ddl.compile(dialect=engine.dialect)).strip() + ";"
            (indexes if isinstance(ddl, CreateIndex) else statements).append(sql)

        engine = create_mock_engine(f"{dialect}://", collect)
        Base.metadata.create_all(engine, checkfirst=False)
        # SQLAlchemy stores indexes in sets. Sort them for reproducible output.
        files[f"{dialect}.sql"] = ("\n\n".join(statements + sorted(indexes)) + "\n").encode()
    files["manifest.json"] = (json.dumps({
        "version": version, "alembic_revision": head,
        "files": {name: hashlib.sha256(data).hexdigest() for name, data in files.items()},
    }, indent=2, sort_keys=True) + "\n").encode()
    return files


def baseline(root: Path, version: str, *, check: bool, destination: Path | None = None) -> None:
    if not requires_baseline(version):
        return
    destination = destination or root / "backend/schema-baselines" / version
    files = baseline_files(root, version)
    if destination.exists():
        if set(p.name for p in destination.iterdir()) != set(files) or any(
            not (destination / name).is_file() or (destination / name).read_bytes() != data
            for name, data in files.items()
        ):
            raise ValueError(f"Baseline {version} differs from the current schema; refusing to overwrite it")
        return
    if check:
        raise ValueError(f"Baseline {version} is missing; run prepare.py before tagging")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".baseline-", dir=destination.parent) as temporary:
        staged = Path(temporary) / version
        staged.mkdir()
        for name, data in files.items():
            (staged / name).write_bytes(data)
        staged.rename(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    baseline(ROOT, args.version, check=args.check)
