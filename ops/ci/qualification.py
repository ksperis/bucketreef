"""Durable qualification evidence, tied to successful jobs and immutable digests."""
import hashlib
import json
import os
from pathlib import Path

from gitlab_api import completed_records
from plan import COMPONENTS, PUBLIC
from registry import DIGEST, credentials, inspect


def validate(record, sha):
    if (record.get("schema") != 1 or record.get("sha") != sha or record.get("ref") != "main"
        or record.get("plan", {}).get("profile") != "qualify" or record["plan"].get("sha") != sha):
        raise ValueError("A complete main qualification for this SHA is required")
    required = {*PUBLIC, "ceph-functional-tests", "helm-kind-onboarding-smoke"}
    required.update(f"{c}-image-vuln-scan" for c in COMPONENTS)
    required.update(f"build-{c}" for c in COMPONENTS)
    if not required <= set(record["plan"]["jobs"]):
        raise ValueError("Qualification omits mandatory validations")
    if set(record.get("images", {})) != set(COMPONENTS):
        raise ValueError("Qualification omits image components")
    for image in record["images"].values():
        if not DIGEST.fullmatch(image.get("digest", "")) or set(image.get("platforms", {})) != {"amd64", "arm64"}:
            raise ValueError("Invalid qualified image index")
        if any(not DIGEST.fullmatch(value) for value in image["platforms"].values()):
            raise ValueError("Invalid qualified platform digest")
    expected = {f"{c}-{a}" for c in COMPONENTS for a in ("amd64", "arm64")}
    if set(record.get("scans", {})) != expected:
        raise ValueError("Qualification omits architecture scan evidence")
    for key, scan in record["scans"].items():
        component, arch = key.rsplit("-", 1)
        if (scan["sha"] != sha or scan["pipeline_id"] != record["pipeline_id"]
            or scan["job_id"] != record["jobs"][f"{component}-image-vuln-scan: [{arch}]"]
            or scan["arch"] != arch or not scan["image"].endswith("@" + record["images"][component]["digest"])
            or not scan.get("created_at") or not scan.get("tool")):
            raise ValueError("Scan evidence differs from qualification")


def complete(record):
    record["images"] = {}
    for component in COMPONENTS:
        receipt = json.loads(Path(f"image-receipts/{component}.json").read_text())
        if receipt["sha"] != record["sha"] or receipt["pipeline_id"] != record["pipeline_id"]:
            raise ValueError("Image receipt belongs to another qualification")
        image = {key: receipt[key] for key in ("digest", "platforms")}
        source = f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{image['digest']}"
        if inspect(source, creds=credentials()) != image:
            raise ValueError("Qualified image differs from its runtime receipt")
        record["images"][component] = image
    record["tools"] = json.loads(Path("ops/ci/tools.json").read_text())
    record["scans"] = {}
    for component in COMPONENTS:
        for arch in ("amd64", "arm64"):
            prefix = Path(f"gl-security-reports/{component}-image-{arch}")
            scan = json.loads(prefix.with_name(prefix.name + "-receipt.json").read_text())
            if hashlib.sha256(prefix.with_name(prefix.name + "-trivy.json").read_bytes()).hexdigest() != scan["report_sha256"]:
                raise ValueError("Scan report differs from its receipt")
            record["scans"][f"{component}-{arch}"] = scan
    validate(record, record["sha"])
    return record


def find(api, sha, pipeline_id=None):
    for record in completed_records(api, "main", "qualification.json", sha):
        if pipeline_id is not None and record["pipeline_id"] != pipeline_id:
            continue
        validate(record, sha)
        for component, image in record["images"].items():
            ref = f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{image['digest']}"
            if inspect(ref, creds=credentials()) != image:
                raise ValueError("Source images differ from their qualification")
        return record
    raise ValueError("No successful complete qualification exists for this exact SHA")
