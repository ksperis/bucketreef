#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe. Licensed under Apache-2.0.
"""Prepare tracked metadata after writing the release's changelog section."""
import argparse
import json
from pathlib import Path
import re

from check_version import check_version
from release_notes import ROOT, changelog_section, version_tuple
from schema_baseline import baseline


def prepare(root: Path, version: str) -> None:
    version_tuple(version)
    changelog_section((root / "CHANGELOG.md").read_text(), version)
    edits = {}
    for filename in ("package.json", "package-lock.json"):
        path = root / "frontend" / filename
        data = json.loads(path.read_text())
        data["version"] = version
        if filename == "package-lock.json":
            data["packages"][""]["version"] = version
        edits[path] = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    chart = root / "deploy/helm/bucketreef/Chart.yaml"
    edits[chart] = re.sub(r"(?m)^(version|appVersion):.*$", lambda m: f"{m[1]}: {version}", chart.read_text())
    compose = root / "deploy/compose/.env.example"
    edits[compose] = re.sub(r"(?m)^BUCKETREEF_TAG=.*$", f"BUCKETREEF_TAG={version}", compose.read_text())
    baseline(root, version, check=False)
    for path, content in edits.items():
        path.write_text(content)
    check_version(root, version)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    args = parser.parse_args()
    prepare(ROOT, args.version)
    print(f"Prepared {args.version}; review the diff before committing and tagging")
