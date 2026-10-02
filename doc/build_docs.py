#!/usr/bin/env python3
"""Build the global documentation shell and all audience-scoped guides."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


DOC_DIR = Path(__file__).resolve().parent
SITE_DIR = DOC_DIR / "site"
MIGRATION_MATRIX = (
    DOC_DIR / "docs" / "developer" / "en" / "documentation" / "reorganization-matrix.md"
)
BUILDS = (
    ("root", None, DOC_DIR / "mkdocs.yml", SITE_DIR),
    ("admin", "en", DOC_DIR / "mkdocs.admin.yml", SITE_DIR / "admin" / "en"),
    ("developer", "en", DOC_DIR / "mkdocs.developer.yml", SITE_DIR / "developer" / "en"),
    ("manager", "en", DOC_DIR / "mkdocs.manager.yml", SITE_DIR / "manager" / "en"),
    ("portal", "en", DOC_DIR / "mkdocs.portal.yml", SITE_DIR / "portal" / "en"),
    ("portal", "fr", DOC_DIR / "mkdocs.portal.fr.yml", SITE_DIR / "portal" / "fr"),
    ("browser", "en", DOC_DIR / "mkdocs.browser.yml", SITE_DIR / "browser" / "en"),
)
GUIDE_NAMES = {name for name, _language, _config, _output in BUILDS[1:]}


def build(config: Path, output: Path, strict: bool) -> None:
    command = [
        sys.executable,
        "-m",
        "mkdocs",
        "build",
        "--config-file",
        str(config),
        "--site-dir",
        str(output),
    ]
    if strict:
        command.append("--strict")
    subprocess.run(command, check=True)


def source_to_location(source: str) -> str:
    path = Path(source)
    if path.name == "index.md":
        parent = path.parent.as_posix()
        return "" if parent == "." else f"{parent}/"
    return f"{path.with_suffix('').as_posix()}/"


def expected_search_locations() -> dict[str, set[str]]:
    expected = {guide: set() for guide in GUIDE_NAMES}
    for line in MIGRATION_MATRIX.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| `"):
            continue

        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 2:
            continue

        targets = re.findall(r"`([^`]+\.md)`", cells[1])
        for target in targets:
            parts = Path(target).parts
            if len(parts) < 3 or parts[0] not in expected or parts[1] != "en":
                continue
            guide = parts[0]
            relative_target = Path(*parts[2:]).as_posix()
            expected[guide].add(source_to_location(relative_target))

    return expected


def validate_search_boundaries() -> None:
    global_search = SITE_DIR / "search" / "search_index.json"
    if global_search.exists():
        raise RuntimeError("Global pages must not expose a search index")

    expected = expected_search_locations()
    for guide, language, _config, output in BUILDS[1:]:
        search_index = output / "search" / "search_index.json"
        if not search_index.is_file():
            raise RuntimeError(f"Missing search index for {guide}/{language}: {search_index}")

        payload = json.loads(search_index.read_text(encoding="utf-8"))
        documents = payload.get("docs")
        if not isinstance(documents, list) or not documents:
            raise RuntimeError(f"Empty search index for {guide}/{language}")

        locations = {
            str(document.get("location", "")).split("#", 1)[0]
            for document in documents
        }
        if any(location.startswith("releases/") for location in locations):
            raise RuntimeError(f"Global release history leaked into {guide}/{language} search")

        missing = expected[guide] - locations
        extra = locations - expected[guide]
        if missing or extra:
            details = []
            if missing:
                details.append(f"missing={sorted(missing)}")
            if extra:
                details.append(f"extra={sorted(extra)}")
            raise RuntimeError(
                f"Search scope for {guide}/{language} differs from the migration matrix: "
                + "; ".join(details)
            )


def validate_portal_translation_parity() -> None:
    portal_root = DOC_DIR / "docs" / "portal"

    def markdown_files(language: str) -> set[str]:
        root = portal_root / language
        return {
            path.relative_to(root).as_posix()
            for path in root.rglob("*.md")
        }

    english = markdown_files("en")
    french = markdown_files("fr")
    if english != french:
        missing = english - french
        extra = french - english
        details = []
        if missing:
            details.append(f"missing={sorted(missing)}")
        if extra:
            details.append(f"extra={sorted(extra)}")
        raise RuntimeError(
            "Portal French documentation must mirror the English page set: "
            + "; ".join(details)
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat MkDocs warnings as build errors for every guide.",
    )
    args = parser.parse_args()

    shutil.rmtree(SITE_DIR, ignore_errors=True)
    validate_portal_translation_parity()
    for _name, _language, config, output in BUILDS:
        build(config, output, args.strict)

    validate_search_boundaries()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
