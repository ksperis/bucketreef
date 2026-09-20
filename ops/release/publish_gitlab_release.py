#!/usr/bin/env python3
# Copyright (c) 2026 Laurent Barbe. Licensed under Apache-2.0.
"""Publish GitLab notes and links only after GitHub's verified release is public."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

from publish_github_release import ASSETS, REPOSITORY
from release_notes import version_tuple


class GitLab:
    def __init__(self, base_url: str, project: str, job_token: str):
        self.base_url = f"{base_url.rstrip('/')}/projects/{project}"
        self.job_token = job_token

    def request(self, path: str, *, method="GET", data=None, missing_ok=False):
        headers = {"JOB-TOKEN": self.job_token, "Content-Type": "application/json"}
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(f"{self.base_url}/{path}", data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404 and missing_ok:
                return None
            raise RuntimeError(f"GitLab {method} failed with HTTP {error.code}") from None


def publish(api, version: str, sha: str, notes: str):
    version_tuple(version)
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not notes.strip():
        raise ValueError("Expected full commit SHA and non-empty release notes")
    tag = f"v{version}"
    # Do not let release creation implicitly create a tag at a different ref.
    if api.request(f"repository/tags/{tag}")["commit"]["id"] != sha:
        raise RuntimeError("GitLab tag SHA differs from the validated commit")
    links = [{"name": name, "url": f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}", "link_type": "package"} for name in ASSETS]
    release = api.request(f"releases/{tag}", missing_ok=True)
    if release is None:
        release = api.request("releases", method="POST", data={
            "tag_name": tag, "name": tag, "description": notes,
            "assets": {"links": links},
        })
    actual_links = {link["name"]: (link["url"], link.get("link_type")) for link in release["assets"]["links"]}
    if (release["description"] != notes or release["name"] != tag
        or release["commit"]["id"] != sha
        or any(actual_links.get(link["name"]) != (link["url"], link["link_type"]) for link in links)):
        raise RuntimeError("Published GitLab release differs; refusing to replace it")
    return release["_links"]["self"]


if __name__ == "__main__":
    try:
        api = GitLab(os.environ["CI_API_V4_URL"], os.environ["CI_PROJECT_ID"], os.environ["CI_JOB_TOKEN"])
        print(publish(api, os.environ["RELEASE_VERSION"], os.environ["CI_COMMIT_SHA"], Path("dist/release-notes/gitlab.md").read_text()))
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print(f"Release publication failed: {error}", file=sys.stderr)
        sys.exit(1)
