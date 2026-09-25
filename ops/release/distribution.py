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
import sys
import tarfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ci"))
from gitlab_api import GitLabAPI, expected_names, successful_jobs
from plan import COMPONENTS
from qualification import find, validate
from registry import copy_image, credentials, inspect
from publish_github_release import GitHub, ASSETS, ensure_tag as ensure_github_tag, publish as publish_github, resolve_tag
from publish_gitlab_release import GitLab, publish as publish_gitlab, resolve_git_tag
import bundle_registry
from recover_gitlab_release import PublicGitHub, verify_public_release

REQUIRED = ["release-tag-metadata", "release-source-images-ready", "release-bundles",
            "publish-candidate-images", "publish-helm-release", "publish-release-bundles",
            "release-public-bundles-check",
            "release-public-images-check", "release-kind-onboarding-smoke", "release-bundle-smoke",
            *(f"{c}-release-image-vuln-scan" for c in COMPONENTS)]

PUBLIC_RELEASE_VERIFY_ATTEMPTS = 6
PUBLIC_RELEASE_VERIFY_DELAY_SECONDS = 5


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


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
    validate(record, os.environ["CI_COMMIT_SHA"])
    return record


def resolve():
    record = find(GitLabAPI(), os.environ["CI_COMMIT_SHA"])
    if os.environ.get("CI_COMMIT_BRANCH") != "main":
        raise ValueError("Release preparation must run from main")
    if resolve_git_tag(version(), missing_ok=True) is not None:
        raise ValueError("GitLab release tag already exists; retry the original finalizer instead")
    if resolve_tag(GitHub(os.environ.get("GITHUB_RELEASE_TOKEN", "")), "v" + version(), missing_ok=True) is not None:
        raise ValueError("GitHub release tag already exists; retry the original finalizer instead")
    write("qualification.json", record)
    Path("release-sources").mkdir(exist_ok=True)
    for component, image in record["images"].items():
        Path(f"release-sources/{component}").write_text(f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{image['digest']}\n")


def candidates():
    for component, image in source_record()["images"].items():
        copy_image(f"{os.environ['CI_REGISTRY_IMAGE']}/{component}@{image['digest']}",
                   f"ghcr.io/ksperis/bucketreef-{component}:{version()}",
                   src_creds=credentials(), dest_creds=credentials(True))


def verify_public():
    for component, image in source_record()["images"].items():
        # Explicit anonymous auth, including the index and both platform digests.
        if inspect(f"ghcr.io/ksperis/bucketreef-{component}:{version()}") != image:
            raise ValueError("Public distribution differs from qualification")


def github(finalize=False, latest=False):
    return publish_github(GitHub(os.environ["GITHUB_RELEASE_TOKEN"]), version(), os.environ["CI_COMMIT_SHA"],
                          Path("dist/release"), latest, Path("dist/release-notes/github.md").read_text(), finalize=finalize)


def ready(api):
    record = source_record()
    pipeline = api.get(f"pipelines/{int(os.environ['CI_PIPELINE_ID'])}")
    plan = read("ci-plan.json")
    if (pipeline["sha"] != record["sha"] or pipeline["ref"] != "main" or pipeline["source"] != "parent_pipeline"
        or plan.get("profile") != "prepare-release" or plan.get("sha") != record["sha"]):
        raise ValueError("Unexpected release validation pipeline")
    jobs = successful_jobs(api.jobs(int(os.environ["CI_PIPELINE_ID"])), expected_names(REQUIRED), record["sha"])
    if find(api, record["sha"], record["pipeline_id"]) != record:
        raise ValueError("Qualification changed during distribution")
    verify_public()
    bundles = read("bundle-distribution.json")
    if bundles["files"] != bundle_registry.hashes(Path("dist/release")) or bundles["sha"] != record["sha"] or bundles["version"] != version():
        raise ValueError("Published bundles differ from prepared assets")
    return {"schema": 1, "sha": record["sha"], "version": version(), "pipeline_id": int(os.environ["CI_PIPELINE_ID"]),
            "qualification_pipeline_id": record["pipeline_id"], "jobs": jobs, "images": record["images"], "bundles": bundles, "files": fingerprints()}


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
                PublicGitHub(), version(), os.environ["CI_COMMIT_SHA"],
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


def finalize():
    # Run under the single public-release resource group. Recheck evidence inside
    # the lock, including retries that have replaced an earlier validation job.
    api = GitLabAPI()
    expected = ready(api)
    if read("distribution-ready.json") != expected:
        raise ValueError("Distribution proof is stale or its artifacts changed")
    gh = GitHub(os.environ["GITHUB_RELEASE_TOKEN"])
    gl = GitLab(os.environ["CI_API_V4_URL"], os.environ["CI_PROJECT_ID"], os.environ["CI_JOB_TOKEN"])
    verify_remote_main(api, gh, os.environ["CI_COMMIT_SHA"])
    ensure_github_tag(gh, "v" + version(), os.environ["CI_COMMIT_SHA"])
    github(finalize=True, latest=True)
    verify_published_github_release(expected["bundles"]["files"])
    publish_gitlab(gl, version(), os.environ["CI_COMMIT_SHA"], Path("dist/release-notes/gitlab.md").read_text())
    for alias in aliases(version(), published_versions(gh, gl)):
        for component, image in source_record()["images"].items():
            repository = f"ghcr.io/ksperis/bucketreef-{component}"
            copy_image(f"{repository}@{image['digest']}", f"{repository}:{alias}",
                       src_creds=credentials(True), dest_creds=credentials(True), immutable=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("resolve", "normalize-chart", "candidates", "verify-public", "publish-bundles", "download-bundles", "ready", "verify-release-tag", "finalize"))
    command = parser.parse_args().command
    try:
        if command == "normalize-chart": normalize_chart(f"dist/release/bucketreef-{version()}.tgz")
        elif command == "resolve": resolve()
        elif command == "candidates": candidates()
        elif command == "verify-public": verify_public()
        elif command == "publish-bundles": write("bundle-distribution.json", bundle_registry.publish(version(), os.environ["CI_COMMIT_SHA"], Path("dist/release")))
        elif command == "download-bundles": bundle_registry.download(read("bundle-distribution.json"), Path("public-bundles"), version=version(), sha=os.environ["CI_COMMIT_SHA"])
        elif command == "ready": write("distribution-ready.json", ready(GitLabAPI()))
        elif command == "verify-release-tag": verify_release_tag()
        else: finalize()
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print(f"Distribution stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
