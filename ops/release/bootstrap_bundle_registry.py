#!/usr/bin/env python3
"""Create the immutable OCI bundle package from an existing stable release tag."""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

import bundle_registry
from publish_github_release import GitHub, resolve_tag
from publish_gitlab_release import resolve_git_tag

ROOT = Path(__file__).resolve().parents[2]


def git(*arguments: str) -> str:
    return subprocess.check_output(["git", *arguments], cwd=ROOT, text=True).strip()


def export_tag(tag: str, destination: Path) -> None:
    archive = subprocess.check_output(["git", "archive", "--format=tar", tag], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as release:
        release.extractall(destination, filter="data")


def bootstrap(version: str) -> dict:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Expected a stable release version")
    tag = f"v{version}"
    sha = git("rev-parse", tag + "^{commit}")
    if resolve_git_tag(version, root=ROOT) != sha:
        raise RuntimeError("Local and remote GitLab release tags differ")
    if resolve_tag(GitHub(os.environ["GITHUB_RELEASE_TOKEN"]), tag) != sha:
        raise RuntimeError("GitHub and GitLab release tags differ")

    with tempfile.TemporaryDirectory() as temporary:
        source = Path(temporary) / "source"
        source.mkdir()
        export_tag(tag, source)
        output = Path(temporary) / "release"
        subprocess.run(
            [sys.executable, str(source / "ops/release/package_bundles.py"),
             "--version", version, "--output", str(output)],
            cwd=source,
            check=True,
        )
        record = bundle_registry.publish(version, sha, output)
    Path("bundle-distribution.json").write_text(json.dumps(record, indent=2) + "\n")
    return record


if __name__ == "__main__":
    try:
        print(json.dumps(bootstrap(os.environ["BUNDLE_BOOTSTRAP_VERSION"]), sort_keys=True))
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f"Bundle registry bootstrap failed: {error}", file=sys.stderr)
        raise SystemExit(1)
