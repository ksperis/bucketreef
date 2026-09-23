#!/usr/bin/env python3
"""Create and push one immutable stable release tag to GitHub, then GitLab."""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess

from check_version import check_version
from release_notes import ROOT, version_tuple
from schema_baseline import baseline


RELEASE_METADATA = (
    "CHANGELOG.md",
    "frontend/package.json",
    "frontend/package-lock.json",
    "deploy/helm/bucketreef/Chart.yaml",
    "deploy/compose/.env.example",
    "backend/schema-baselines",
)


def git(*args: str, root: Path = ROOT, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def remote_ref(remote: str, ref: str, *, root: Path = ROOT) -> str | None:
    lines = git("ls-remote", remote, ref, f"{ref}^{{}}", root=root).splitlines()
    refs = {name: sha for sha, name in (line.split("\t", 1) for line in lines if "\t" in line)}
    return refs.get(f"{ref}^{{}}") or refs.get(ref)


def _check_metadata(root: Path, version: str) -> None:
    check_version(root, version)
    baseline(root, version, check=True)
    changed = git("diff", "--name-only", "HEAD", "--", *RELEASE_METADATA, root=root)
    if changed:
        raise RuntimeError("Release metadata must be committed before tagging: " + ", ".join(changed.splitlines()))


def tag(version: str, *, root: Path = ROOT, github_remote: str = "github",
        gitlab_remote: str = "gitlab") -> str:
    version_tuple(version)
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Version must be X.Y.Z")
    if git("branch", "--show-current", root=root) != "main":
        raise RuntimeError("Release tags must be created from main")
    head = git("rev-parse", "HEAD", root=root)
    if not re.fullmatch(r"[0-9a-f]{40}", head):
        raise RuntimeError("Unable to resolve HEAD")
    _check_metadata(root, version)

    github_main = remote_ref(github_remote, "refs/heads/main", root=root)
    gitlab_main = remote_ref(gitlab_remote, "refs/heads/main", root=root)
    if github_main != head or gitlab_main != head:
        raise RuntimeError("HEAD must match main on both GitHub and GitLab before tagging")

    name = f"v{version}"
    ref = f"refs/tags/{name}"
    local = git("rev-parse", f"{name}^{{commit}}", root=root, check=False)
    if local and local != head:
        raise RuntimeError(f"Local tag {name} points to another commit; refusing to move it")
    if not local:
        git("tag", name, head, root=root)

    for remote in (github_remote, gitlab_remote):
        existing = remote_ref(remote, ref, root=root)
        if existing and existing != head:
            raise RuntimeError(f"Remote tag {remote}/{name} points to another commit; refusing to move it")

    if remote_ref(github_remote, ref, root=root) is None:
        git("push", github_remote, f"{ref}:{ref}", root=root)
        if remote_ref(github_remote, ref, root=root) != head:
            raise RuntimeError("GitHub tag was not visible at the expected SHA after push")

    if remote_ref(gitlab_remote, ref, root=root) is None:
        git("push", gitlab_remote, f"{ref}:{ref}", root=root)
        if remote_ref(gitlab_remote, ref, root=root) != head:
            raise RuntimeError("GitLab tag was not visible at the expected SHA after push")

    return head


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="Stable version X.Y.Z")
    parser.add_argument("--github-remote", default="github")
    parser.add_argument("--gitlab-remote", default="gitlab")
    args = parser.parse_args()
    sha = tag(args.version, github_remote=args.github_remote, gitlab_remote=args.gitlab_remote)
    print(f"v{args.version} is present on GitHub and GitLab at {sha}")
