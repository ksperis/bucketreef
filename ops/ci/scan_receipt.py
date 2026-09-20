#!/usr/bin/env python3
"""Bind a successful scan report to its immutable input and actual tool version."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


def receipt(report, image, arch):
    if arch not in {"amd64", "arm64"} or "@sha256:" not in image:
        raise ValueError("Expected a digest and supported architecture")
    data = json.loads(report.read_bytes())
    if data.get("ArtifactName") != image or not data.get("CreatedAt"):
        raise ValueError("Scan report does not identify its input and date")
    return {"image": image, "arch": arch, "sha": os.environ["CI_COMMIT_SHA"],
            "pipeline_id": int(os.environ["CI_PIPELINE_ID"]), "job_id": int(os.environ["CI_JOB_ID"]),
            "created_at": data["CreatedAt"], "completed_at": datetime.now(timezone.utc).isoformat(),
            "tool": subprocess.check_output(["trivy", "--version"], text=True).strip(),
            "report_sha256": hashlib.sha256(report.read_bytes()).hexdigest()}


if __name__ == "__main__":
    report = Path(sys.argv[1])
    report.with_name(report.name.replace("-trivy.json", "-receipt.json")).write_text(
        json.dumps(receipt(report, sys.argv[2], sys.argv[3]), indent=2) + "\n")
