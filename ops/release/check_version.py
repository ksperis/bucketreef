#!/usr/bin/env python3
"""Fail release preparation when tracked metadata does not match the Git tag."""
import json
from pathlib import Path
import re
import sys
from history import documentation_for_root
from release_notes import ROOT, changelog_section, version_tuple


def check_version(root: Path, version: str) -> None:
    version_tuple(version)
    chart = (root / "deploy/helm/bucketreef/Chart.yaml").read_text()
    values = [
        json.loads((root / "frontend/package.json").read_text())["version"],
        json.loads((root / "frontend/package-lock.json").read_text())["version"],
        json.loads((root / "frontend/package-lock.json").read_text())["packages"][""]["version"],
    ]
    for key in ("version", "appVersion"):
        values.append(re.search(rf"(?m)^{key}:\s*[\"']?([0-9.]+)", chart).group(1))
    values.append(re.search(r"(?m)^BUCKETREEF_TAG=(.+)$", (root / "deploy/bundle/.env.example").read_text()).group(1))
    if any(value != version for value in values):
        raise ValueError("Release metadata mismatch: run ops/release/prepare.py")
    changelog_section((root / "CHANGELOG.md").read_text(), version)
    release_documentation = root / "doc/docs/releases.md"
    if not release_documentation.exists() or release_documentation.read_text() != documentation_for_root(root):
        raise ValueError("Release documentation mismatch: run ops/release/prepare.py")


if __name__ == "__main__":
    check_version(ROOT, sys.argv[1])
    print(f"Release metadata and changelog match {sys.argv[1]}")
