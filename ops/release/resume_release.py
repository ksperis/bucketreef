#!/usr/bin/env python3
"""Resume any ready candidate, using only its retained proofs and tested bytes."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

import distribution as dist
import candidate_registry
from gitlab_api import GitLabAPI, successful_jobs
from release_notes import version_tuple


def source_artifact(api, job, path):
    data = api.artifact(job, path)
    if data is None:
        raise ValueError(f"Missing retained release artifact: {path}")
    return data


def load_source(api):
    version = os.environ["RELEASE_RECOVERY_VERSION"]
    version_tuple(version)
    if not re.fullmatch(r"[1-9][0-9]*", os.environ["RELEASE_RECOVERY_PIPELINE_ID"]):
        raise ValueError("RELEASE_RECOVERY_PIPELINE_ID must be a positive integer")
    pipeline_id = int(os.environ["RELEASE_RECOVERY_PIPELINE_ID"])
    pipeline = api.get(f"pipelines/{pipeline_id}")
    if pipeline["ref"] != "main" or pipeline["source"] != "parent_pipeline":
        raise ValueError("Recovery requires a main release child pipeline")
    sha = pipeline["sha"]
    ready_job = successful_jobs(api.jobs(pipeline_id), ["release-ready"], sha)["release-ready"]
    proof = json.loads(source_artifact(api, ready_job, "distribution-ready.json"))
    if (proof.get("schema") != 2 or proof.get("sha") != sha or proof.get("version") != version
            or proof.get("pipeline_id") != pipeline_id):
        raise ValueError("Unsupported or mismatched distribution proof; a tested candidate is required")
    subprocess.run(["git", "merge-base", "--is-ancestor", sha, os.environ["CI_COMMIT_SHA"]], check=True)
    os.environ["RELEASE_SOURCE_SHA"] = sha
    os.environ["RELEASE_VERSION"] = version
    dist.write("distribution-ready.json", proof)
    for path in ("qualification.json", "candidate-inventory.json"):
        Path(path).write_bytes(source_artifact(api, ready_job, path))
    plan = json.loads(source_artifact(api, ready_job, "ci-plan.json"))
    dist.write("source-plan.json", plan)
    Path("installation-receipts").mkdir(exist_ok=True)
    for key in ("amd64", "arm64", "kind"):
        path = f"installation-receipts/{key}.json"
        Path(path).write_bytes(source_artifact(api, ready_job, path))
    inventory = dist.inventory_record()
    candidate_registry.download(inventory, Path("public-candidate"))
    candidate_registry.restore(inventory, Path("public-candidate"))
    # Restore only saved demo members, never arbitrary archive paths or sources.
    archive = api.get(f"jobs/{ready_job}/artifacts", binary=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        for name in proof["demo_files"]:
            if Path(name).is_absolute() or ".." in Path(name).parts:
                raise ValueError("Unsafe demo artifact member")
            path = Path("frontend/dist-demo") / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(zipped.read(str(path)))
    if dist.ready(api, pipeline_id=pipeline_id, plan=plan) != proof:
        raise ValueError("Retained distribution no longer matches its successful gates")
    return proof, plan


def prepare():
    proof, _ = load_source(GitLabAPI())
    Path("release-tags.env").write_text(f"RELEASE_VERSION={proof['version']}\nRELEASE_SOURCE_SHA={proof['sha']}\n")
    result = {"schema": 2, "sha": proof["sha"], "version": proof["version"],
              "orchestration_sha": os.environ["CI_COMMIT_SHA"], "source_pipeline_id": proof["pipeline_id"],
              "distribution_sha256": dist.digest(proof)}
    dist.write("recovery-release.json", result)
    return result


def finalize():
    expected = dist.read("recovery-release.json")
    api = GitLabAPI()
    current = int(os.environ["CI_PIPELINE_ID"])
    pipeline = api.get(f"pipelines/{current}")
    plan = dist.read("ci-plan.json")
    if (pipeline["sha"] != os.environ["CI_COMMIT_SHA"] or pipeline["ref"] != "main"
            or pipeline["source"] != "parent_pipeline" or plan.get("profile") != "resume-release"
            or plan.get("sha") != pipeline["sha"] or plan.get("recovery_version") != expected["version"]
            or plan.get("recovery_pipeline_id") != expected["source_pipeline_id"]
            or expected["orchestration_sha"] != pipeline["sha"]):
        raise ValueError("Recovery orchestration differs from its plan")
    successful_jobs(api.jobs(current), ["resume-release-assets"], pipeline["sha"])
    proof, source_plan = load_source(api)
    if expected["distribution_sha256"] != dist.digest(proof) or expected["sha"] != proof["sha"]:
        raise ValueError("Recovery candidate changed")
    return dist.finalize(source_pipeline_id=proof["pipeline_id"], source_plan=source_plan)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "finalize"))
    args = parser.parse_args()
    prepare() if args.command == "prepare" else finalize()
