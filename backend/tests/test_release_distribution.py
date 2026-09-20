import hashlib
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
            expected = {"VERSION", "LICENSE", "README.md", ".env.example", "docker-compose.yml"}
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
    ci = yaml.safe_load((ROOT / ".gitlab-ci.yml").read_text())
    assert ci[".multiarch-image-scan"]["parallel"]["matrix"] == [{"IMAGE_ARCH": ["amd64", "arm64"]}]
    for component in ("backend", "frontend", "scheduler"):
        assert ci[f"{component}-release-image-vuln-scan"]["extends"] == ".multiarch-image-scan"
        assert f"{component}-release-image-vuln-scan" in ci[f"promote-{component}-release"]["needs"]
        assert "release-kind-onboarding-smoke" in ci[f"promote-{component}-release"]["needs"]
        assert f"promote-{component}-release" in ci["publish-helm-release"]["needs"]
    assert "publish-helm-release" in ci["publish-github-release"]["needs"]
    assert "release-bundle-smoke" in ci["publish-github-release"]["needs"]
    for template in (".promote-public-image", ".promote-internal-image"):
        assert "skopeo copy --all --preserve-digests" in "\n".join(ci[template]["script"])


@pytest.mark.parametrize("failed", [False, True])
def test_sha_tag_is_published_only_after_both_runtime_checks(tmp_path, failed):
    docker = tmp_path / "docker"
    log = tmp_path / "commands.log"
    docker.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_TEST_LOG"
case "$*" in
  *'--entrypoint python'*) [ "$FAIL_RUNTIME" = false ] || exit 1 ;;
esac
''')
    docker.chmod(0o755)
    result = subprocess.run(["sh", str(ROOT / "ops/ci/build-image.sh")], env={
        **os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "DOCKER_TEST_LOG": str(log),
        "FAIL_RUNTIME": str(failed).lower(), "CI_REGISTRY_IMAGE": "registry.example/project",
        "IMAGE_COMPONENT": "backend", "CI_COMMIT_SHA": "a" * 40, "CI_JOB_ID": "123",
        "BINFMT_IMAGE": "binfmt-test",
    }, capture_output=True, text=True)
    commands = log.read_text()
    if failed:
        assert result.returncode != 0
        assert "imagetools create" not in commands
    else:
        assert result.returncode == 0, result.stderr
        assert "--platform linux/amd64 --read-only" in commands
        assert "--platform linux/arm64 --read-only" in commands
        assert commands.index("imagetools create") > commands.rindex("--entrypoint python")


@pytest.mark.parametrize("version, expected", [
    ("1.2.3", "1.2.3"),
    ("1.2.10", "1.2.10,1.2"),
    ("1.3.0", "1.3.0,1.3,latest"),
])
def test_aliases_do_not_regress_when_old_release_jobs_are_retried(tmp_path, version, expected):
    git = tmp_path / "git"
    git.write_text("#!/bin/sh\nprintf '%s\\n' 'a refs/tags/v1.2.3' 'b refs/tags/v1.2.10' 'c refs/tags/v1.3.0' 'd refs/tags/v2.0.0-rc1'\n")
    git.chmod(0o755)
    result = subprocess.run(["sh", str(ROOT / "ops/release/image-tags.sh"), version], env={
        **os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "CI_REPOSITORY_URL": "fixture",
    }, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == expected


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
