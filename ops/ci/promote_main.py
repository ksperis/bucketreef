#!/usr/bin/env python3
"""Publish the private moving main channel from exact image build receipts."""
import json
import os
from pathlib import Path
import subprocess

from plan import COMPONENTS
from registry import copy_image, credentials


def promote():
    sha = os.environ["CI_COMMIT_SHA"]
    pipeline_id = int(os.environ["CI_PIPELINE_ID"])
    if os.environ.get("CI_COMMIT_BRANCH") != os.environ.get("CI_DEFAULT_BRANCH", "main"):
        raise ValueError("Main image promotion requires the default branch")

    auth = credentials()
    sources = {}
    for component in COMPONENTS:
        receipt = json.loads(Path(f"image-receipts/{component}.json").read_text())
        if receipt.get("sha") != sha or receipt.get("pipeline_id") != pipeline_id:
            raise ValueError("Main promotion requires image receipts from this pipeline")
        repository = f"{os.environ['CI_REGISTRY_IMAGE']}/{component}"
        source = f"{repository}@{receipt['digest']}"
        sources[component] = (repository, source)
        copy_image(source, f"{repository}:main-{sha}", src_creds=auth, dest_creds=auth)

    head = subprocess.check_output(["git", "ls-remote", "origin", "refs/heads/main"], text=True).split()[0]
    if head != sha:
        print("Main has advanced; keeping its current alias")
        return

    for repository, source in sources.values():
        copy_image(source, f"{repository}:main", src_creds=auth, dest_creds=auth, immutable=False)


if __name__ == "__main__":
    promote()
