#!/usr/bin/env python3
"""Prepare a distribution on main, then create stable tags only during finalization."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ci"))
from gitlab_api import GitLabAPI, expected_names, successful_jobs
from plan import COMPONENTS
from qualification import validate, verify_jobs
from registry import copy_image, credentials, inspect
from publish_github_release import GitHub, ASSETS, ensure_tag as ensure_github_tag, publish as publish_github, resolve_tag
from publish_gitlab_release import GitLab, publish as publish_gitlab, resolve_git_tag
import bundle_registry
import candidate_registry
from recover_gitlab_release import PublicGitHub, verify_public_release

REQUIRED = ["integration-ready", "frontend-demo", "release-tag-metadata", "release-source-images-ready", "release-bundles",
            "publish-candidate-images", "publish-candidate-artifacts", "release-public-bundles-check",
            "release-public-images-check", "release-kind-onboarding-smoke", "release-bundle-smoke",
            *(f"{c}-release-image-vuln-scan" for c in COMPONENTS)]

PUBLIC_RELEASE_VERIFY_ATTEMPTS = 6
PUBLIC_RELEASE_VERIFY_DELAY_SECONDS = 5


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def release_sha():
    return os.environ.get("RELEASE_SOURCE_SHA") or os.environ["CI_COMMIT_SHA"]


def candidate_tag():
    return f"candidate-{release_sha()}-{int(os.environ['CI_PIPELINE_ID'])}"


def version():
    value = os.environ["RELEASE_VERSION"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value):
        raise ValueError("Expected a stable release version")
    return value


def files():
    return [*(Path("dist/release") / name for name in ASSETS),
            Path(f"dist/release/bucketreef-{version()}.tgz"),
            Path("dist/release-notes/github.md"), Path("dist/release-notes/gitlab.md")]


def fingerprints():
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in files()}


def normalize_chart(path):
    """Helm packages contain current timestamps; normalize once before publication."""
    with tarfile.open(path, "r:gz") as archive:
        entries = []
        for entry in archive.getmembers():
            if not entry.isfile() or entry.name.startswith("/") or ".." in Path(entry.name).parts:
                raise ValueError("Unexpected packaged chart entry")
            entries.append((entry.name, entry.mode, archive.extractfile(entry).read()))
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", filename="", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, mode, data in sorted(entries):
                entry = tarfile.TarInfo(name)
                entry.mode, entry.size = mode, len(data)
                archive.addfile(entry, io.BytesIO(data))
    Path(path).write_bytes(buffer.getvalue())


def source_record():
    record = read("qualification.json")
    validate(record, release_sha())
    return record


def resolve():
    record = verify_jobs(GitLabAPI(), source_record())
    if os.environ.get("CI_COMMIT_BRANCH") != "main":
        raise ValueError("Release preparation must run from main")
    if resolve_git_tag(version(), missing_ok=True) is not None:
        raise ValueError("GitLab release tag already exists; retry the original finalizer instead")
    if resolve_tag(GitHub(os.environ.get("GITHUB_RELEASE_TOKEN", "")), "v" + version(), missing_ok=True) is not None:
        raise ValueError("GitHub release tag already exists; retry the original finalizer instead")
    for component in COMPONENTS:
        if inspect(f"ghcr.io/ksperis/bucketreef-{component}:{version()}", missing_ok=True) is not None:
            raise ValueError("Stable promotion already started; use resume-release with its retained proof")
    write("qualification.json", record)
    Path("release-sources").mkdir(exist_ok=True)
    for component, image in record["images"].items():
        Path(f"release-sources/{component}").write_text(f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{image['digest']}\n")


def candidates():
    for component, image in source_record()["images"].items():
        copy_image(f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{image['digest']}",
                   f"ghcr.io/ksperis/bucketreef-{component}:{candidate_tag()}",
                   src_creds=credentials(), dest_creds=credentials(True))


def publish_candidate():
    qualification = source_record()
    inventory = {"schema": 2, "version": version(), "sha": release_sha(),
                 "pipeline_id": int(os.environ["CI_PIPELINE_ID"]), "job_id": int(os.environ["CI_JOB_ID"]),
                 "tag": candidate_tag(), "images": qualification["images"],
                 "qualification_sha256": digest(qualification), "files": fingerprints(),
                 "artifact": candidate_registry.publish(candidate_tag(), version(), release_sha())}
    write("candidate-inventory.json", inventory)
    return inventory


def inventory_record():
    inventory = read("candidate-inventory.json")
    record = source_record()
    if (inventory.get("schema") != 2 or inventory.get("sha") != release_sha()
            or inventory.get("version") != version() or inventory.get("images") != record["images"]
            or inventory.get("qualification_sha256") != digest(record)
            or inventory.get("tag") != f"candidate-{release_sha()}-{inventory['pipeline_id']}"):
        raise ValueError("Candidate inventory differs from qualification")
    return inventory


def verify_public():
    inventory = inventory_record()
    for component, image in inventory["images"].items():
        # Explicit anonymous auth, including the index and both platform digests.
        if inspect(f"ghcr.io/ksperis/bucketreef-{component}:{inventory['tag']}") != image:
            raise ValueError("Public distribution differs from qualification")


def github(finalize=False, latest=False):
    return publish_github(GitHub(os.environ["GITHUB_RELEASE_TOKEN"]), version(), release_sha(),
                          Path("dist/release"), latest, Path("dist/release-notes/github.md").read_text(), finalize=finalize)


def demo_fingerprints():
    directory = Path("frontend/dist-demo")
    if not (directory / "demo-release.json").is_file():
        raise ValueError("Tested demo artifact is missing")
    metadata = read(directory / "demo-release.json")
    if metadata["revision"] != release_sha() or metadata["version"] != version():
        raise ValueError("Demo differs from the release sources")
    return {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob("*")) if path.is_file()}


def validate_installation(receipt, key, inventory):
    phases = {"install-and-upgrade"} if key == "kind" else {"first-start", "restart", "compose"}
    components = {"backend", "frontend"} if key == "kind" else set(COMPONENTS)
    arch = "amd64" if key == "kind" else key
    if set(receipt.get("checkpoints", {})) != phases:
        raise ValueError("Installation proof omits a required phase")
    for images in receipt["checkpoints"].values():
        if set(images) != components:
            raise ValueError("Installation proof omits an image")
        for component, image in images.items():
            if (image.get("manifest") != inventory["images"][component]["platforms"][arch]
                    or image.get("arch") != arch or image.get("os") != "linux"
                    or not re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("id", ""))):
                raise ValueError("Installation proof has a different image or architecture")


def ready(api, *, pipeline_id=None, plan=None):
    record = source_record()
    pipeline_id = pipeline_id or int(os.environ["CI_PIPELINE_ID"])
    pipeline = api.get(f"pipelines/{pipeline_id}")
    plan = plan or read("ci-plan.json")
    if (pipeline["sha"] != record["sha"] or pipeline["ref"] != "main" or pipeline["source"] != "parent_pipeline"
        or plan.get("profile") != "prepare-release" or plan.get("sha") != record["sha"]):
        raise ValueError("Unexpected release validation pipeline")
    jobs = successful_jobs(api.jobs(pipeline_id), expected_names(REQUIRED), record["sha"])
    verify_jobs(api, record)
    inventory = inventory_record()
    if (inventory["pipeline_id"] != pipeline_id or inventory["job_id"] != jobs["publish-candidate-artifacts"]
            or inventory["files"] != fingerprints()):
        raise ValueError("Candidate files or producer differ")
    verify_public()
    installations = {}
    for key, job in (("amd64", "release-bundle-smoke: [amd64]"), ("arm64", "release-bundle-smoke: [arm64]"),
                     ("kind", "release-kind-onboarding-smoke")):
        receipt = read(f"installation-receipts/{key}.json")
        if (receipt.get("schema") != 1 or receipt.get("status") != "success"
                or receipt.get("sha") != record["sha"] or receipt.get("version") != version()
                or receipt.get("pipeline_id") != pipeline_id or receipt.get("job_id") != jobs[job]
                or receipt.get("candidate_sha256") != digest(inventory)):
            raise ValueError("Installation evidence does not match this candidate and successful job")
        validate_installation(receipt, key, inventory)
        installations[key] = receipt
    return {"schema": 2, "sha": record["sha"], "version": version(), "pipeline_id": pipeline_id,
            "qualification_pipeline_id": record["pipeline_id"], "jobs": jobs, "images": record["images"],
            "candidate": inventory, "installations": installations, "files": fingerprints(), "demo_files": demo_fingerprints()}


def aliases(current, published):
    number = lambda value: tuple(map(int, value.split(".")))
    versions = {v for v in published if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", v)}
    if current not in versions:
        raise ValueError("Only a fully published distribution may advance aliases")
    minor = current.rsplit(".", 1)[0]
    result = []
    if number(current) == max(number(v) for v in versions if v.rsplit(".", 1)[0] == minor):
        result.append(minor)
    if number(current) == max(map(number, versions)):
        result.append("latest")
    return result


def published_versions(github_api, gitlab_api):
    page = 1
    versions = []
    while True:
        releases = github_api.request(f"releases?per_page=100&page={page}")
        for release in releases:
            tag = release["tag_name"]
            if release["draft"] or release["prerelease"] or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
                continue
            private = gitlab_api.request(f"releases/{tag}", missing_ok=True)
            if private and private["commit"]["id"] == resolve_tag(github_api, tag):
                versions.append(tag[1:])
        if len(releases) < 100:
            return versions
        page += 1


def verify_published_github_release(expected_files):
    """Allow the anonymous GitHub release view a short propagation window."""
    for attempt in range(PUBLIC_RELEASE_VERIFY_ATTEMPTS):
        try:
            verify_public_release(
                PublicGitHub(), version(), release_sha(),
                Path("dist/release-notes/github.md").read_text(),
                expected_files=expected_files,
            )
            return
        except RuntimeError as error:
            if not str(error).startswith("Missing public release asset:"):
                raise
            transient = error
        except OSError as error:
            transient = error
        if attempt + 1 == PUBLIC_RELEASE_VERIFY_ATTEMPTS:
            raise transient
        time.sleep(PUBLIC_RELEASE_VERIFY_DELAY_SECONDS)


def verify_remote_main(gitlab_api, github_api, sha):
    gitlab_sha = gitlab_api.get("repository/branches/main")["commit"]["id"]
    github_sha = github_api.request("git/ref/heads/main")["object"]["sha"]
    if gitlab_sha != sha or github_sha != sha:
        raise RuntimeError("main moved after release preparation; refusing to create a stable tag")


def verify_release_tag():
    sha = os.environ["CI_COMMIT_SHA"]
    tag = "v" + version()
    gh = GitHub(os.environ.get("GITHUB_RELEASE_TOKEN", ""))
    gl = GitLab(os.environ["CI_API_V4_URL"], os.environ["CI_PROJECT_ID"], os.environ["CI_JOB_TOKEN"])
    if resolve_tag(gh, tag) != sha or resolve_git_tag(version()) != sha:
        raise RuntimeError("Stable tag differs between GitHub, GitLab and the pipeline commit")
    release = gh.request(f"releases/tags/{tag}", missing_ok=True)
    if release is None or release.get("draft") or release.get("prerelease") or release.get("name") != tag:
        raise RuntimeError("GitHub stable tag does not have a published stable release")
    private = gl.request(f"releases/{tag}", missing_ok=True)
    if private is None or private.get("commit", {}).get("id") != sha or private.get("name") != tag:
        raise RuntimeError("GitLab stable tag does not have the matching published release")


def promote_stable(expected):
    """Only called under public-release, after every installation gate."""
    for component, image in expected["images"].items():
        repository = f"ghcr.io/ksperis/bucketreef-{component}"
        copy_image(f"{repository}@{image['digest']}", f"{repository}:{version()}",
                   src_creds=credentials(True), dest_creds=credentials(True))
    bundles = bundle_registry.publish(version(), release_sha(), Path("dist/release"))
    write("bundle-distribution.json", bundles)
    subprocess.run(["sh", "ops/release/publish-chart.sh"], check=True)
    for component, image in expected["images"].items():
        if inspect(f"ghcr.io/ksperis/bucketreef-{component}:{version()}") != image:
            raise ValueError("Stable image differs from tested candidate")
    with tempfile.TemporaryDirectory() as temporary:
        bundle_registry.download(bundles, Path(temporary), version=version(), sha=release_sha())
    return bundles


def finalize(*, source_pipeline_id=None, source_plan=None):
    # Run under the single public-release resource group. Recheck evidence inside
    # the lock, including retries that have replaced an earlier validation job.
    api = GitLabAPI()
    expected = ready(api, pipeline_id=source_pipeline_id, plan=source_plan)
    if read("distribution-ready.json") != expected:
        raise ValueError("Distribution proof is stale or its artifacts changed")
    gh = GitHub(os.environ["GITHUB_RELEASE_TOKEN"])
    gl = GitLab(os.environ["CI_API_V4_URL"], os.environ["CI_PROJECT_ID"], os.environ["CI_JOB_TOKEN"])
    verify_remote_main(api, gh, os.environ["CI_COMMIT_SHA"])
    # Fetch by candidate digest again inside the lock. Never package current sources.
    with tempfile.TemporaryDirectory() as temporary:
        candidate_registry.download(expected["candidate"], Path(temporary))
        if candidate_registry.hashes(Path(temporary), version()) != {Path(path).name: value for path, value in expected["files"].items()}:
            raise ValueError("Public candidate bytes differ from installation proof")
    bundles = promote_stable(expected)
    ensure_github_tag(gh, "v" + version(), release_sha())
    github(finalize=True, latest=False)
    verify_published_github_release(bundles["files"])
    publish_gitlab(gl, version(), release_sha(), Path("dist/release-notes/gitlab.md").read_text())
    if resolve_tag(gh, "v" + version()) != release_sha() or resolve_git_tag(version()) != release_sha():
        raise RuntimeError("Published forge tags differ from release sources")
    targets = aliases(version(), published_versions(gh, gl))
    for alias in targets:
        for component, image in source_record()["images"].items():
            repository = f"ghcr.io/ksperis/bucketreef-{component}"
            copy_image(f"{repository}@{image['digest']}", f"{repository}:{alias}",
                       src_creds=credentials(True), dest_creds=credentials(True), immutable=False)
            if inspect(f"{repository}:{alias}") != image:
                raise ValueError("Public alias differs after promotion")
    if "latest" in targets:
        release = gh.request(f"releases/tags/v{version()}")
        current = gh.request("releases/latest", missing_ok=True)
        if current is None or tuple(map(int, current["tag_name"].removeprefix("v").split("."))) <= tuple(map(int, version().split("."))):
            gh.request(f"releases/{release['id']}", method="PATCH", data={"make_latest": "true"})
    result = {"schema": 2, "version": version(), "sha": release_sha(), "orchestration_sha": os.environ["CI_COMMIT_SHA"],
              "pipeline_id": int(os.environ["CI_PIPELINE_ID"]), "job_id": int(os.environ["CI_JOB_ID"]),
              "distribution_sha256": digest(expected), "candidate": expected["candidate"],
              "bundles": bundles, "files": expected["files"], "demo_files": expected["demo_files"], "aliases": targets}
    write("publication.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("resolve", "normalize-chart", "candidates", "publish-candidate", "verify-public", "download-candidate", "ready", "verify-release-tag", "finalize"))
    command = parser.parse_args().command
    try:
        if command == "normalize-chart": normalize_chart(f"dist/release/bucketreef-{version()}.tgz")
        elif command == "resolve": resolve()
        elif command == "candidates": candidates()
        elif command == "verify-public": verify_public()
        elif command == "publish-candidate": publish_candidate()
        elif command == "download-candidate": candidate_registry.download(inventory_record(), Path("public-candidate"))
        elif command == "ready": write("distribution-ready.json", ready(GitLabAPI()))
        elif command == "verify-release-tag": verify_release_tag()
        else: finalize()
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f"Distribution stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
