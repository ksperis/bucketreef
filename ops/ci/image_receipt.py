#!/usr/bin/env python3
import json
import os
from pathlib import Path

from registry import credentials, inspect


def record():
    component = os.environ["IMAGE_COMPONENT"]
    digest = Path(f"image-receipts/{component}.digest").read_text().strip()
    image = inspect(f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{digest}", creds=credentials())
    tag = inspect(f"{os.environ['CI_REGISTRY_IMAGE']}/{component}:{os.environ['CI_COMMIT_SHA']}", creds=credentials())
    if tag != image:
        raise ValueError("SHA tag does not identify the tested digest")
    image.update(sha=os.environ["CI_COMMIT_SHA"], pipeline_id=int(os.environ["CI_PIPELINE_ID"]))
    Path(f"image-receipts/{component}.json").write_text(json.dumps(image, indent=2) + "\n")


if __name__ == "__main__":
    record()
