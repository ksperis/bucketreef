#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe. Licensed under Apache-2.0.
"""Extract immutable release notes from the changelog and reachable stable tags."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
VERSION_PATTERN = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"


def version_tuple(version: str) -> tuple[int, int, int]:
    if not re.fullmatch(VERSION_PATTERN, version):
        raise ValueError("Expected a stable X.Y.Z version without leading zeroes")
    return tuple(map(int, version.split(".")))


def changelog_section(changelog: str, version: str) -> str:
    version_tuple(version)
    headings = list(re.finditer(r"^## .+$", changelog, re.MULTILINE))
    matches = [i for i, heading in enumerate(headings) if re.fullmatch(
        rf"## \[?{re.escape(version)}\]?(?: - \d{{4}}-\d{{2}}-\d{{2}})?", heading.group()
    )]
    if len(matches) != 1:
        raise ValueError(f"CHANGELOG.md must contain exactly one section for {version}")
    index = matches[0]
    end = headings[index + 1].start() if index + 1 < len(headings) else len(changelog)
    section = changelog[headings[index].start():end].strip()
    if not any(line.strip() and not line.startswith("#") for line in section.splitlines()[1:]):
        raise ValueError(f"CHANGELOG.md section {version} is empty")
    return section + "\n"


def previous_tag(root: Path, version: str, commit: str) -> str | None:
    target = version_tuple(version)
    tags = subprocess.check_output(
        ["git", "tag", "--merged", commit, "--list", "v*"], cwd=root, text=True,
    ).splitlines()
    stable = [tag for tag in tags if re.fullmatch("v" + VERSION_PATTERN, tag)
              and version_tuple(tag[1:]) < target]
    return max(stable, key=lambda tag: version_tuple(tag[1:])) if stable else None


def render_notes(section: str, version: str, previous: str | None, repository_url: str, *, gitlab=False) -> str:
    if previous is None:
        return section
    path = "/-/compare/" if gitlab else "/compare/"
    url = f"{repository_url.rstrip('/')}{path}{previous}...v{version}"
    return section.rstrip() + f"\n\n**Full changelog:** [{previous}...v{version}]({url})\n"


def generate_notes(root: Path, version: str, commit: str, gitlab_url: str, output: Path) -> None:
    section = changelog_section((root / "CHANGELOG.md").read_text(), version)
    previous = previous_tag(root, version, commit)
    output.mkdir(parents=True, exist_ok=True)
    for platform, url in (("github", "https://github.com/ksperis/bucketreef"), ("gitlab", gitlab_url)):
        (output / f"{platform}.md").write_text(render_notes(section, version, previous, url, gitlab=platform == "gitlab"))
    (output / "release.json").write_text(json.dumps({
        "version": version, "commit": commit, "previous_tag": previous,
    }, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--commit", default=os.environ.get("CI_COMMIT_SHA", "HEAD"))
    parser.add_argument("--gitlab-url", default=os.environ.get("CI_PROJECT_URL", "https://gitlab.ksperis.com/laurent/bucketreef"))
    parser.add_argument("--output", type=Path, default=Path("dist/release-notes"))
    args = parser.parse_args()
    generate_notes(ROOT, args.version, args.commit, args.gitlab_url, args.output)
