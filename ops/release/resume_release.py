#!/usr/bin/env python3
"""Resume an interrupted prepared release without replacing immutable artifacts."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ci"))

from gitlab_api import GitLabAPI, successful_jobs
from qualification import find, validate
from registry import copy_image, credentials, inspect

import bundle_registry
from distribution import aliases, published_versions
from publish_github_release import ASSETS, GitHub, ensure_tag, publish as publish_github, resolve_tag
from publish_gitlab_release import GitLab, publish as publish_gitlab, resolve_git_tag
from recover_gitlab_release import PublicGitHub, verify_public_release
from release_notes import ROOT, version_tuple


SOURCE_SUCCESS = (
    "release-tag-metadata",
    "release-source-images-ready",
    "release-bundles",
    "backend-release-image-vuln-scan: [amd64]",
    "backend-release-image-vuln-scan: [arm64]",
    "frontend-release-image-vuln-scan: [amd64]",
    "frontend-release-image-vuln-scan: [arm64]",
    "scheduler-release-image-vuln-scan: [amd64]",
    "scheduler-release-image-vuln-scan: [arm64]",
    "publish-candidate-images",
    "publish-helm-release",
    "publish-release-bundles",
    "release-public-bundles-check",
    "release-public-images-check",
    "release-bundle-smoke: [amd64]",
    "release-kind-onboarding-smoke",
)
ARM64_SMOKE = "release-bundle-smoke: [arm64]"
RECOVERY_JOBS = ("resume-release-assets", "resume-release-bundle-smoke")
ALLOWED_RECOVERY_PATHS = (".gitlab-ci.yml", "ops/ci/", "ops/release/", "doc/docs/developer/")


def _version() -> str:
    value = os.environ["RELEASE_RECOVERY_VERSION"]
    version_tuple(value)
    return value


def _source_pipeline_id() -> int:
    value = os.environ["RELEASE_RECOVERY_PIPELINE_ID"]
    if not re.fullmatch(r"[1-9][0-9]*", value):
        raise ValueError("RELEASE_RECOVERY_PIPELINE_ID must be a positive integer")
    return int(value)


def _artifact(api: GitLabAPI, job_id: int, path: str) -> bytes:
    value = api.artifact(job_id, path)
    if value is None:
        raise ValueError(f"Missing retained release artifact: {path}")
    return value


def _json_artifact(api: GitLabAPI, job_id: int, path: str) -> dict:
    try:
        value = json.loads(_artifact(api, job_id, path))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid retained release artifact: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"Invalid retained release artifact: {path}")
    return value


def _job_map(jobs: list[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for job in jobs:
        name = job["name"]
        if name in result:
            raise ValueError(f"Ambiguous source release job: {name}")
        result[name] = job
    return result


def _validate_recovery_paths(release_sha: str, recovery_sha: str) -> list[str]:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", release_sha, recovery_sha],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode:
        raise ValueError("Recovery commit must descend from the prepared release commit")
    raw = subprocess.check_output(
        ["git", "diff", "--name-only", "--no-renames", "-z", release_sha, recovery_sha, "--"],
        cwd=ROOT,
    )
    paths = sorted({item.decode("utf-8") for item in raw.split(b"\0") if item})
    invalid = [
        path for path in paths
        if not any(path == allowed or (allowed.endswith("/") and path.startswith(allowed)) for allowed in ALLOWED_RECOVERY_PATHS)
    ]
    if invalid:
        raise ValueError("Recovery history contains product changes: " + ", ".join(invalid))
    return paths


def _verify_chart(version: str, expected: Path) -> str:
    with tempfile.TemporaryDirectory() as temporary:
        subprocess.run(
            [
                "helm", "pull", "oci://ghcr.io/ksperis/charts/bucketreef",
                "--version", version, "--destination", temporary,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        actual = Path(temporary) / f"bucketreef-{version}.tgz"
        if actual.read_bytes() != expected.read_bytes():
            raise ValueError("Public Helm chart differs from the prepared release artifact")
    return hashlib.sha256(expected.read_bytes()).hexdigest()


def _verify_public_images(version: str, qualification: dict) -> None:
    for component, image in qualification["images"].items():
        if inspect(f"ghcr.io/ksperis/bucketreef-{component}:{version}") != image:
            raise ValueError(f"Public {component} image differs from the original qualification")


def _write_source_artifacts(api: GitLabAPI, jobs: dict[str, dict], version: str, release_sha: str) -> tuple[dict, dict, dict]:
    release_job = jobs["release-tag-metadata"]["id"]
    tags = _artifact(api, release_job, "release-tags.env").decode()
    values = dict(line.split("=", 1) for line in tags.splitlines() if "=" in line)
    if values.get("RELEASE_VERSION") != version:
        raise ValueError("Recovery version differs from the prepared release")

    release_meta = _json_artifact(api, release_job, "dist/release-notes/release.json")
    if release_meta.get("version") != version or release_meta.get("commit") != release_sha:
        raise ValueError("Prepared release metadata differs from the source pipeline")

    notes_dir = Path("dist/release-notes")
    notes_dir.mkdir(parents=True, exist_ok=True)
    for name in ("github.md", "gitlab.md", "release.json"):
        (notes_dir / name).write_bytes(_artifact(api, release_job, f"dist/release-notes/{name}"))

    source_job = jobs["release-source-images-ready"]["id"]
    qualification = _json_artifact(api, source_job, "qualification.json")
    validate(qualification, release_sha)
    if find(api, release_sha, qualification["pipeline_id"]) != qualification:
        raise ValueError("Original qualification no longer matches its retained evidence")
    Path("qualification.json").write_text(json.dumps(qualification, indent=2) + "\n")

    bundle_job = jobs["publish-release-bundles"]["id"]
    bundles = _json_artifact(api, bundle_job, "bundle-distribution.json")
    if bundles.get("version") != version or bundles.get("sha") != release_sha:
        raise ValueError("Published bundle proof differs from the prepared release")
    Path("bundle-distribution.json").write_text(json.dumps(bundles, indent=2) + "\n")

    build_job = jobs["release-bundles"]["id"]
    release_dir = Path("dist/release")
    release_dir.mkdir(parents=True, exist_ok=True)
    for name in (*ASSETS, f"bucketreef-{version}.tgz"):
        (release_dir / name).write_bytes(_artifact(api, build_job, f"dist/release/{name}"))
    if bundle_registry.hashes(release_dir) != bundles["files"]:
        raise ValueError("Retained release bundles differ from their immutable publication proof")

    return qualification, bundles, release_meta


def _source_record(api: GitLabAPI, *, write_artifacts: bool = True) -> dict:
    version = _version()
    source_pipeline_id = _source_pipeline_id()
    pipeline = api.get(f"pipelines/{source_pipeline_id}")
    if (
        pipeline.get("source") != "parent_pipeline"
        or pipeline.get("ref") != "main"
        or pipeline.get("status") != "failed"
    ):
        raise ValueError("Recovery source must be the failed prepared-release child pipeline")
    release_sha = pipeline["sha"]
    if not re.fullmatch(r"[0-9a-f]{40}", release_sha):
        raise ValueError("Recovery source pipeline has an invalid commit SHA")

    jobs = api.jobs(source_pipeline_id)
    successful = successful_jobs(jobs, list(SOURCE_SUCCESS), release_sha)
    indexed = _job_map(jobs)
    arm64 = indexed.get(ARM64_SMOKE)
    if arm64 is None or arm64.get("status") != "failed" or arm64["commit"]["id"] != release_sha:
        raise ValueError("Recovery source must have only the arm64 bundle smoke left unresolved")
    for name in ("release-ready", "finalize-release"):
        if indexed.get(name, {}).get("status") == "success":
            raise ValueError("Prepared release was already finalized")

    recovery_sha = os.environ["CI_COMMIT_SHA"]
    paths = _validate_recovery_paths(release_sha, recovery_sha)

    qualification, bundles, release_meta = _write_source_artifacts(api, indexed, version, release_sha)
    _verify_public_images(version, qualification)

    public_dir = Path("public-bundles")
    public_dir.mkdir(exist_ok=True)
    bundle_registry.download(bundles, public_dir, version=version, sha=release_sha)
    chart_sha256 = _verify_chart(version, Path("dist/release") / f"bucketreef-{version}.tgz")

    gh = GitHub(os.environ.get("GITHUB_RELEASE_TOKEN", ""))
    github_tag = resolve_tag(gh, f"v{version}", missing_ok=True)
    gitlab_tag = resolve_git_tag(version, missing_ok=True)
    if github_tag not in {None, release_sha} or gitlab_tag not in {None, release_sha}:
        raise ValueError("Existing stable tag points to another commit")

    return {
        "schema": 1,
        "version": version,
        "sha": release_sha,
        "recovery_sha": recovery_sha,
        "source_pipeline_id": source_pipeline_id,
        "source_jobs": {**successful, ARM64_SMOKE: arm64["id"]},
        "qualification_pipeline_id": qualification["pipeline_id"],
        "images": qualification["images"],
        "bundles": bundles,
        "release": release_meta,
        "chart_sha256": chart_sha256,
        "recovery_paths": paths,
    }


def prepare() -> dict:
    record = _source_record(GitLabAPI())
    Path("recovery-release.json").write_text(json.dumps(record, indent=2) + "\n")
    return record


def _verify_current_recovery(api: GitLabAPI, record: dict) -> None:
    current_sha = os.environ["CI_COMMIT_SHA"]
    pipeline_id = int(os.environ["CI_PIPELINE_ID"])
    pipeline = api.get(f"pipelines/{pipeline_id}")
    plan = json.loads(Path("ci-plan.json").read_text())
    if (
        pipeline.get("source") != "parent_pipeline"
        or pipeline.get("ref") != "main"
        or pipeline.get("sha") != current_sha
        or plan.get("profile") != "resume-release"
        or plan.get("sha") != current_sha
        or plan.get("recovery_version") != record["version"]
        or plan.get("recovery_pipeline_id") != record["source_pipeline_id"]
    ):
        raise ValueError("Unexpected release-recovery pipeline")
    successful_jobs(api.jobs(pipeline_id), list(RECOVERY_JOBS), current_sha)


def _verify_remote_main(api: GitLabAPI, github: GitHub, sha: str) -> None:
    gitlab_sha = api.get("repository/branches/main")["commit"]["id"]
    github_sha = github.request("git/ref/heads/main")["object"]["sha"]
    if gitlab_sha != sha or github_sha != sha:
        raise RuntimeError("main moved during release recovery")


def finalize() -> dict:
    expected = json.loads(Path("recovery-release.json").read_text())
    api = GitLabAPI()
    actual = _source_record(api)
    if expected != actual:
        raise ValueError("Recovery proof is stale or the prepared distribution changed")
    _verify_current_recovery(api, actual)

    current_sha = os.environ["CI_COMMIT_SHA"]
    version = actual["version"]
    release_sha = actual["sha"]
    gh = GitHub(os.environ["GITHUB_RELEASE_TOKEN"])
    gl = GitLab(os.environ["CI_API_V4_URL"], os.environ["CI_PROJECT_ID"], os.environ["CI_JOB_TOKEN"])
    _verify_remote_main(api, gh, current_sha)

    ensure_tag(gh, f"v{version}", release_sha)
    publish_github(
        gh,
        version,
        release_sha,
        Path("dist/release"),
        True,
        Path("dist/release-notes/github.md").read_text(),
        finalize=True,
    )
    verify_public_release(
        PublicGitHub(),
        version,
        release_sha,
        Path("dist/release-notes/github.md").read_text(),
        expected_files=actual["bundles"]["files"],
    )
    publish_gitlab(
        gl,
        version,
        release_sha,
        Path("dist/release-notes/gitlab.md").read_text(),
        root=ROOT,
        remote="origin",
    )

    for alias in aliases(version, published_versions(gh, gl)):
        for component, image in actual["images"].items():
            repository = f"ghcr.io/ksperis/bucketreef-{component}"
            copy_image(
                f"{repository}@{image['digest']}",
                f"{repository}:{alias}",
                src_creds=credentials(True),
                dest_creds=credentials(True),
                immutable=False,
            )

    if resolve_tag(gh, f"v{version}") != release_sha or resolve_git_tag(version) != release_sha:
        raise RuntimeError("Recovered stable tags do not match the prepared release commit")

    result = {
        "schema": 1,
        "version": version,
        "sha": release_sha,
        "recovery_sha": current_sha,
        "source_pipeline_id": actual["source_pipeline_id"],
    }
    Path("recovery-finalized.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "finalize"))
    args = parser.parse_args()
    try:
        value = prepare() if args.command == "prepare" else finalize()
        print(json.dumps(value, indent=2))
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f"Release resume failed: {error}", file=sys.stderr)
        raise SystemExit(1)
