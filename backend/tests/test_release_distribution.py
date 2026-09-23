import hashlib
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tarfile

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/release"))
NOTES = "## 1.2.3 - 2026-09-20\n\n- Release fixture.\n"
package = runpy.run_path(str(ROOT / "ops/release/package_bundles.py"))["package_bundles"]
publisher = runpy.run_path(str(ROOT / "ops/release/publish_github_release.py"))


def test_bundles_are_reproducible_versioned_and_source_free(tmp_path):
    first = package("1.2.3", tmp_path / "first")
    second = package("1.2.3", tmp_path / "second")
    assert [p.read_bytes() for p in first] == [p.read_bytes() for p in second]
    for archive in first[::2]:
        with tarfile.open(archive) as tar:
            expected = {
                "VERSION",
                "LICENSE",
                "README.md",
                ".env.example",
                "docker-compose.yml",
                "docker-compose.admin.yml",
                "docker-compose.user.yml",
            }
            if "quickstart" in archive.name:
                expected.add("bucketreef-quickstart")
            assert set(tar.getnames()) == expected
            assert all(entry.isfile() for entry in tar)
            assert tar.extractfile("VERSION").read() == b"1.2.3\n"
            assert b"BUCKETREEF_TAG=1.2.3\n" in tar.extractfile(".env.example").read()
            compose = yaml.safe_load(tar.extractfile("docker-compose.yml"))
            assert all("build" not in service for service in compose["services"].values())
            assert all("latest" not in service["image"] for service in compose["services"].values())
        assert archive.with_name(archive.name + ".sha256").read_text() == f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive.name}\n"


class GitHubFixture:
    def __init__(self, sha="a" * 40):
        self.sha = sha
        self.release = None
        self.assets = []
        self.writes = []

    def request(self, path, *, method="GET", data=None, **kwargs):
        if method != "GET":
            self.writes.append((path, method, data))
        if path.startswith("git/ref/"):
            return {"object": {"type": "commit", "sha": self.sha}}
        if path.startswith("releases/tags/"):
            return self.release
        if path == "releases/latest":
            return None
        if path == "releases" and method == "POST":
            self.release = {"id": 1, "draft": True, "prerelease": False, "upload_url": "https://uploads.github.com/assets{?name}", "body": data["body"], "name": data["name"]}
            return self.release
        if path.startswith("releases/1/assets"):
            return self.assets
        if path.startswith("https://uploads.github.com/"):
            asset = {"name": path.split("?name=")[1], "digest": "sha256:" + hashlib.sha256(data).hexdigest(), "size": len(data), "state": "uploaded"}
            self.assets.append(asset)
            return asset
        if path == "releases/1" and method == "PATCH":
            self.release.update(data)
            return self.release
        raise AssertionError(path)


def test_publish_verifies_before_exposing_release_and_retry_is_read_only(tmp_path):
    package("1.2.3", tmp_path)
    api = GitHubFixture()
    publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    assert len(api.assets) == 4
    assert api.writes[-1] == ("releases/1", "PATCH", {"draft": False, "make_latest": "true"})
    api.writes.clear()
    publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    assert api.writes == []


def test_published_assets_cannot_be_replaced(tmp_path):
    package("1.2.3", tmp_path)
    api = GitHubFixture()
    publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, False, NOTES)
    api.assets[0]["digest"] = "sha256:incorrect"
    api.writes.clear()
    with pytest.raises(RuntimeError, match="differs"):
        publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, False, NOTES)
    assert not api.writes


def test_published_release_notes_cannot_be_replaced(tmp_path):
    package("1.2.3", tmp_path)
    api = GitHubFixture()
    publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    api.writes.clear()
    with pytest.raises(RuntimeError, match="notes or name differ"):
        publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, "Changed notes")
    assert not api.writes


def test_different_mirror_commit_never_creates_release(tmp_path):
    api = GitHubFixture(sha="b" * 40)
    with pytest.raises(RuntimeError, match="SHA differs"):
        publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    assert not api.writes


def test_retry_of_an_older_release_does_not_regress_latest(tmp_path):
    package("1.2.3", tmp_path)
    api = GitHubFixture()
    original = api.request
    api.request = lambda path, **kwargs: {"tag_name": "v1.3.0"} if path == "releases/latest" else original(path, **kwargs)
    publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    assert api.writes[-1][2]["make_latest"] == "false"


def test_release_gates_cover_all_architectures_and_artifacts():
    sys.path.insert(0, str(ROOT / "ops/ci"))
    from plan import select
    from render_gitlab import render
    from distribution import REQUIRED
    ci = render({**select("release", []), "sha": "a" * 40})
    assert ci[".multiarch-image-scan"]["parallel"]["matrix"] == [{"IMAGE_ARCH": ["amd64", "arm64"]}]
    assert set(REQUIRED) <= {need["job"] for need in ci["release-ready"]["needs"]}
    assert "release-ready" in {need["job"] for need in ci["finalize-release"]["needs"]}
    assert ci["finalize-release"]["resource_group"] == "public-release"
    assert not any(name.startswith("build-") for name in ci)
    for component in ("backend", "frontend", "scheduler"):
        assert ci[f"{component}-release-image-vuln-scan"]["extends"] == ".multiarch-image-scan"
        assert f"{component}-release-image-vuln-scan" in {n["job"] for n in ci["publish-candidate-images"]["needs"]}


@pytest.mark.parametrize("failed", [False, True])
@pytest.mark.parametrize("existing", ["missing", "complete", "incomplete", "denied"])
@pytest.mark.parametrize("inspection", [
    "valid", "invalid-digest", "missing-digest", "malformed", "denied",
    "missing-platform", "duplicate-platform", "invalid-platform-digest",
])
def test_sha_tag_is_published_only_after_both_runtime_checks(tmp_path, failed, existing, inspection):
    docker = tmp_path / "docker"
    log = tmp_path / "commands.log"
    docker.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_TEST_LOG"
case "$*" in
  *'--format {{json .Manifest}}')
    case "$INDEX_INSPECTION" in
      malformed) echo 'Name: registry.example/project/backend' ;;
      denied) echo 'unauthorized' >&2; exit 1 ;;
      *) printf '%s\\n' "$INDEX_JSON" ;;
    esac ;;
  *'--format'*) echo 'Name: registry.example/project/backend' ;;
  *':build-'*) echo '{"manifests":[]}' ;;
  'buildx imagetools inspect --raw '*)
    case "$EXISTING_IMAGE" in
      missing) echo 'manifest unknown' >&2; exit 1 ;;
      denied) echo 'unauthorized' >&2; exit 1 ;;
      *) echo '{"manifests":[]}' ;;
    esac ;;
  *'--entrypoint python'*) [ "$FAIL_RUNTIME" = false ] || exit 1 ;;
esac
''')
    docker.chmod(0o755)
    # The external index validator reports whether both architectures exist.
    jq = tmp_path / "jq"
    jq.write_text('#!/bin/sh\n[ "$EXISTING_IMAGE" = complete ]\n')
    jq.chmod(0o755)
    index = {"digest": "sha256:" + "0" * 64, "manifests": [
        {"digest": "sha256:" + "1" * 64, "platform": {"os": "linux", "architecture": "amd64"}},
        {"digest": "sha256:" + "2" * 64, "platform": {"os": "linux", "architecture": "arm64"}},
        {"digest": "sha256:" + "3" * 64, "platform": {"os": "unknown", "architecture": "unknown"}},
    ]}
    if inspection == "invalid-digest":
        index["digest"] = "not-a-digest"
    elif inspection == "missing-digest":
        index.pop("digest")
    elif inspection == "missing-platform":
        index["manifests"].pop(1)
    elif inspection == "duplicate-platform":
        index["manifests"].append(index["manifests"][1])
    elif inspection == "invalid-platform-digest":
        index["manifests"][1]["digest"] = "not-a-digest"
    result = subprocess.run(["sh", str(ROOT / "ops/ci/build-image.sh")], env={
        **os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "DOCKER_TEST_LOG": str(log),
        "FAIL_RUNTIME": str(failed).lower(), "CI_REGISTRY_IMAGE": "registry.example/project",
        "EXISTING_IMAGE": existing, "INDEX_INSPECTION": inspection,
        "INDEX_JSON": json.dumps(index),
        "IMAGE_COMPONENT": "backend", "CI_COMMIT_SHA": "a" * 40, "CI_JOB_ID": "123",
        "BINFMT_IMAGE": "binfmt-test", "BUILDKIT_IMAGE":"buildkit-test", "CI_COMMIT_REF_SLUG":"main",
    }, capture_output=True, text=True, cwd=tmp_path)
    commands = log.read_text()
    if existing in ("incomplete", "denied"):
        assert result.returncode != 0
        assert "buildx build" not in commands
        assert "imagetools create" not in commands
        assert "--entrypoint python" not in commands
    elif inspection != "valid":
        assert result.returncode != 0
        assert "--entrypoint python" not in commands
        assert "imagetools create" not in commands
        assert not (tmp_path / "image-receipts/backend.digest").exists()
    elif failed:
        assert result.returncode != 0
        assert "imagetools create" not in commands
    else:
        assert result.returncode == 0, result.stderr
        assert "--format {{json .Manifest}}" in commands
        assert "--platform linux/amd64 --read-only" in commands
        assert "--platform linux/arm64 --read-only" in commands
        for arch, digit in (("amd64", "1"), ("arm64", "2")):
            reference = "registry.example/project/backend@sha256:" + digit * 64
            assert f"pull --platform linux/{arch} {reference}" in commands
            assert f"--entrypoint python {reference}" in commands
        assert (tmp_path / "image-receipts/backend.digest").read_text().strip() == index["digest"]
        if existing == "complete":
            assert "buildx build" not in commands
            assert "imagetools create" not in commands
        else:
            assert "--output type=image,push=true,oci-artifact=false" in commands
            assert commands.index("imagetools create") > commands.rindex("--entrypoint python")
            assert f"registry.example/project/backend@{index['digest']}" in commands.split("imagetools create")[1]




def test_interrupted_asset_upload_resumes_before_publication(tmp_path):
    package("1.2.3", tmp_path)
    api = GitHubFixture()
    original = api.request

    def interrupt(path, **kwargs):
        if path.startswith("https://uploads.github.com/") and len(api.assets) == 2:
            raise RuntimeError("Interrupted upload")
        return original(path, **kwargs)

    api.request = interrupt
    with pytest.raises(RuntimeError, match="Interrupted"):
        publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    assert api.release["draft"]
    assert len(api.assets) == 2
    api.request = original
    api.writes.clear()
    publisher["publish"](api, "1.2.3", "a" * 40, tmp_path, True, NOTES)
    assert len(api.assets) == 4
    assert len([entry for entry in api.writes if entry[1] == "POST"]) == 2
    assert api.writes[-1][1] == "PATCH"
