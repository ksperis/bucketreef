#!/usr/bin/env python3
"""Rescan the latest stable distribution by its qualification digests; never push."""
import os
from pathlib import Path
import subprocess
import sys

from gitlab_api import GitLabAPI, completed_records
from qualification import validate

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "release"))
from publish_github_release import resolve_tag
from recover_gitlab_release import PublicGitHub


def scan():
    public = PublicGitHub()
    release = public.request("releases/latest")
    if release["draft"] or release["prerelease"]:
        raise ValueError("Expected a published stable distribution")
    sha = resolve_tag(public, release["tag_name"])
    record = next(completed_records(GitLabAPI(), "main", "qualification.json", sha), None)
    if not record or record["plan"]["profile"] != "qualify":
        raise ValueError("Published distribution lacks qualification evidence; no mutable-tag fallback")
    validate(record, sha)
    for component in ("backend", "frontend", "scheduler"):
        digest = record["images"][component]["digest"]
        for arch in ("amd64", "arm64"):
            subprocess.run(["sh", "ops/ci/scan-image.sh"], check=True, env={
                **os.environ, "IMAGE_COMPONENT": component, "IMAGE_ARCH": arch,
                "SCAN_KIND": "scheduled", "SOURCE_IMAGE": f"ghcr.io/ksperis/bucketreef-{component}@{digest}",
                "TRIVY_USERNAME": "", "TRIVY_PASSWORD": "",
            })


if __name__ == "__main__":
    scan()
