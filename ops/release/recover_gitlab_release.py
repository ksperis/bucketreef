#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe. Licensed under Apache-2.0.
"""Recover GitLab metadata for an immutable, already public GitHub release."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import urllib.request

from publish_github_release import ASSETS, REPOSITORY, resolve_tag
from publish_gitlab_release import GitLab, publish, resolve_git_tag
from release_notes import ROOT, changelog_section, previous_tag, render_notes, version_tuple


class PublicGitHub:
    def download(self, url):
        with urllib.request.urlopen(url, timeout=120) as response:
            return response.read()

    def request(self, path):
        return json.loads(self.download(f"https://api.github.com/repos/{REPOSITORY}/{path}"))


def verify_public_release(api, version, sha, notes):
    tag = f"v{version}"
    if resolve_tag(api, tag) != sha:
        raise RuntimeError("GitHub and GitLab release tags differ")
    release = api.request(f"releases/tags/{tag}")
    if (release["draft"] or release["prerelease"] or release["tag_name"] != tag
        or release["name"] != tag or release["body"] != notes):
        raise RuntimeError("GitHub release must be public with the exact tagged changelog")
    assets = {asset["name"]: asset for asset in release["assets"]}
    files = {}
    for name in ASSETS:
        asset = assets.get(name, {})
        url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
        if asset.get("browser_download_url") != url or asset.get("state") != "uploaded":
            raise RuntimeError(f"Missing public release asset: {name}")
        data = api.download(url)
        if (asset.get("digest") != "sha256:" + hashlib.sha256(data).hexdigest()
            or asset.get("size") != len(data)):
            raise RuntimeError(f"Public release asset differs: {name}")
        files[name] = data
    for kind in ("compose", "quickstart"):
        name = f"bucketreef-{kind}.tar.gz"
        expected = f"{hashlib.sha256(files[name]).hexdigest()}  {name}\n".encode()
        if files[name + ".sha256"] != expected:
            raise RuntimeError(f"Public release checksum differs: {name}")


def recover(api, github, version, gitlab_url, *, root=ROOT, remote="origin"):
    version_tuple(version)
    sha = resolve_git_tag(version, root=root, remote=remote)
    tag = f"v{version}"
    local_sha = subprocess.check_output(["git", "rev-parse", tag + "^{commit}"], cwd=root, text=True).strip()
    if sha != local_sha:
        raise RuntimeError("Local and remote GitLab release tags differ")
    changelog = subprocess.check_output(["git", "show", f"{sha}:CHANGELOG.md"], cwd=root, text=True)
    section = changelog_section(changelog, version)
    previous = previous_tag(root, version, sha)
    github_notes = render_notes(section, version, previous, f"https://github.com/{REPOSITORY}")
    verify_public_release(github, version, sha, github_notes)
    notes = render_notes(section, version, previous, gitlab_url, gitlab=True)
    return publish(api, version, sha, notes, root=root, remote=remote)


if __name__ == "__main__":
    try:
        version = os.environ.get("GITLAB_RELEASE_RECOVERY_VERSION") or json.loads((ROOT / "frontend/package.json").read_text())["version"]
        api = GitLab(os.environ["CI_API_V4_URL"], os.environ["CI_PROJECT_ID"], os.environ["CI_JOB_TOKEN"])
        print(recover(api, PublicGitHub(), version, os.environ["CI_PROJECT_URL"]))
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f"Release recovery failed: {error}", file=sys.stderr)
        sys.exit(1)
