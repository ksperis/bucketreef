#!/usr/bin/env python3
"""Promote validated components only; a stale integration cannot move dev."""
import json
import os
from pathlib import Path
import subprocess

from registry import copy_image, credentials


def promote():
    sha, component = os.environ["CI_COMMIT_SHA"], os.environ["IMAGE_COMPONENT"]
    record = json.loads(Path("integration.json").read_text())
    receipt = json.loads(Path(f"image-receipts/{component}.json").read_text())
    if record["sha"] != sha or receipt["sha"] != sha or receipt["pipeline_id"] != record["pipeline_id"]:
        raise ValueError("Dev promotion requires this integration's image receipt")
    repository = f"{os.environ['CI_REGISTRY_IMAGE']}/{component}"
    source = f"{repository}@{receipt['digest']}"
    copy_image(source, f"{repository}:dev-{sha}", src_creds=credentials(), dest_creds=credentials())
    # Executed under the common internal-dev-images lock.
    head = subprocess.check_output(["git", "ls-remote", "origin", "refs/heads/dev"], text=True).split()[0]
    if head == sha:
        copy_image(source, f"{repository}:dev", src_creds=credentials(), dest_creds=credentials(), immutable=False)
    else:
        print("Dev has advanced; keeping its current alias")


if __name__ == "__main__":
    promote()
