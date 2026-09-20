#!/usr/bin/env python3
"""Publish verified release bundles, refusing to replace existing asset contents."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

REPOSITORY = "ksperis/bucketreef"
ASSETS = tuple(f"bucketreef-{kind}.tar.gz{suffix}" for kind in ("compose", "quickstart") for suffix in ("", ".sha256"))


class GitHub:
    def __init__(self, token: str):
        self.token = token

    def request(self, path: str, *, method="GET", data=None, binary=False, missing_ok=False):
        url = path if path.startswith("https://uploads.github.com/") else f"https://api.github.com/repos/{REPOSITORY}/{path}"
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if data is not None:
            headers["Content-Type"] = "application/octet-stream" if binary else "application/json"
            if not binary:
                data = json.dumps(data).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers, method=method), timeout=120) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404 and missing_ok:
                return None
            # Do not print request headers, tokens, or arbitrary API response bodies.
            raise RuntimeError(f"GitHub {method} failed with HTTP {error.code}") from None


def resolve_tag(api, tag: str) -> str:
    ref = api.request(f"git/ref/tags/{tag}")["object"]
    while ref["type"] == "tag":
        ref = api.request(f"git/tags/{ref['sha']}")["object"]
    if ref["type"] != "commit":
        raise RuntimeError("Release tag does not resolve to a commit")
    return ref["sha"]


def publish(api, version: str, sha: str, directory: Path, latest: bool, notes: str, *, finalize: bool = True):
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Expected a stable version and full commit SHA")
    tag = f"v{version}"
    if not notes.strip():
        raise ValueError("Release notes must not be empty")
    if resolve_tag(api, tag) != sha:
        raise RuntimeError("GitHub tag SHA differs from the validated GitLab commit")
    files = {name: (directory / name).read_bytes() for name in ASSETS}
    for kind in ("compose", "quickstart"):
        name = f"bucketreef-{kind}.tar.gz"
        expected = f"{hashlib.sha256(files[name]).hexdigest()}  {name}\n".encode()
        if files[name + ".sha256"] != expected:
            raise RuntimeError(f"Invalid local checksum for {name}")

    release = api.request(f"releases/tags/{tag}", missing_ok=True)
    if release is None:
        release = api.request("releases", method="POST", data={
            "tag_name": tag, "target_commitish": sha, "name": tag,
            "draft": True, "prerelease": False,
            "body": notes,
        })
    if release.get("body") != notes or release.get("name") != tag:
        raise RuntimeError("Existing release notes or name differ; refusing to replace them")
    if release["prerelease"]:
        raise RuntimeError("Refusing to reuse a prerelease as a stable release")
    # Paginate: additional user assets must not hide a conflicting bundle.
    existing = {}
    page = 1
    while True:
        entries = api.request(f"releases/{release['id']}/assets?per_page=100&page={page}")
        existing.update({entry["name"]: entry for entry in entries})
        if len(entries) < 100:
            break
        page += 1
    for name, data in files.items():
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        if name in existing:
            if existing[name].get("digest") != digest or existing[name].get("size") != len(data):
                raise RuntimeError(f"Existing asset differs or lacks a verifiable digest: {name}")
            continue
        if not release["draft"]:
            raise RuntimeError(f"Published release is incomplete; refusing to modify it: {name}")
        asset = api.request(release["upload_url"].split("{")[0] + "?name=" + name, method="POST", data=data, binary=True)
        if asset.get("digest") != digest or asset.get("size") != len(data) or asset.get("state") != "uploaded":
            raise RuntimeError(f"Uploaded asset could not be verified: {name}")
    if release["draft"] and finalize:
        # The pipeline's initial alias calculation can become stale while a
        # newer release finishes. Serialized publication must not regress latest.
        current = api.request("releases/latest", missing_ok=True) if latest else None
        if current:
            current_version = current["tag_name"].removeprefix("v")
            if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", current_version):
                raise RuntimeError("Current latest release has an unexpected version")
            latest = tuple(map(int, version.split("."))) >= tuple(map(int, current_version.split(".")))
        api.request(f"releases/{release['id']}", method="PATCH", data={"draft": False, "make_latest": "true" if latest else "false"})
    return f"https://github.com/{REPOSITORY}/releases/tag/{tag}"


if __name__ == "__main__":
    try:
        print(publish(GitHub(os.environ["GITHUB_RELEASE_TOKEN"]), os.environ["RELEASE_VERSION"], os.environ["CI_COMMIT_SHA"], Path("dist/release"), "latest" in os.environ["RELEASE_GHCR_TAGS"].split(","), Path("dist/release-notes/github.md").read_text()))
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print(f"Release publication failed: {error}", file=sys.stderr)
        sys.exit(1)
