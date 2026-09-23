import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ops/release"))
sys.path.insert(0, str(ROOT / "ops/ci"))

import preflight
import publish_github_release as github_release
from plan import select
from render_gitlab import render


SHA = "a" * 40


class GitLab:
    def __init__(self, sha=SHA):
        self.sha = sha

    def get(self, path):
        assert path == "repository/branches/main"
        return {"commit": {"id": self.sha}}


class GitHub:
    def __init__(self, sha=SHA, push=True):
        self.sha = sha
        self.push = push

    def request(self, path):
        if path == "":
            return {"permissions": {"push": self.push}}
        assert path == "git/ref/heads/main"
        return {"object": {"sha": self.sha}}


def environment():
    return {
        "CI_COMMIT_SHA": SHA,
        "CI_COMMIT_BRANCH": "main",
        "GITLAB_CI_READ_API_TOKEN": "gitlab-token",
        "GITHUB_RELEASE_TOKEN": "github-token",
        "GHCR_USERNAME": "publisher",
        "GHCR_TOKEN": "ghcr-token",
    }


def release_root(tmp_path):
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / "package.json").write_text(json.dumps({"version": "0.2.7"}))
    return tmp_path


def test_preflight_checks_remote_main_metadata_and_registry_access(monkeypatch, tmp_path):
    root = release_root(tmp_path)
    checked = []
    monkeypatch.setattr(preflight, "check_version", lambda current, version: checked.append(("version", current, version)))
    monkeypatch.setattr(preflight, "baseline", lambda current, version, check: checked.append(("baseline", current, version, check)))
    registry = []
    monkeypatch.setattr(preflight, "_oras_tags", lambda repository, **kwargs: registry.append((repository, kwargs)) or ["0.2.6"])

    record = preflight.run(root=root, env=environment(), gitlab=GitLab(), github=GitHub())

    assert record["status"] == "success"
    assert record["checks"]["release-metadata"]["version"] == "0.2.7"
    assert len(registry) == len(preflight.GHCR_REPOSITORIES) + len(preflight.ANONYMOUS_REPOSITORIES)
    assert checked[-1] == ("baseline", root, "0.2.7", True)


def test_preflight_fails_before_tag_when_variable_or_remote_is_invalid(monkeypatch, tmp_path):
    root = release_root(tmp_path)
    monkeypatch.setattr(preflight, "check_version", lambda *args: None)
    monkeypatch.setattr(preflight, "baseline", lambda *args, **kwargs: None)
    monkeypatch.setattr(preflight, "_oras_tags", lambda *args, **kwargs: ["0.2.6"])
    env = environment()
    env["GHCR_TOKEN"] = ""

    record = preflight.run(root=root, env=env, gitlab=GitLab(), github=GitHub(sha="b" * 40))

    assert record["status"] == "failed"
    assert record["checks"]["release-variables"]["status"] == "failed"
    assert record["checks"]["remote-main"]["status"] == "failed"
    assert "github-token" not in json.dumps(record)
    assert "gitlab-token" not in json.dumps(record)


def test_github_http_error_identifies_path_without_exposing_token(monkeypatch):
    def fail(request, timeout):
        assert request.get_header("Authorization") == "Bearer super-secret"
        raise github_release.urllib.error.HTTPError(request.full_url, 404, "missing", None, None)

    monkeypatch.setattr(github_release.urllib.request, "urlopen", fail)
    api = github_release.GitHub("super-secret")

    with pytest.raises(RuntimeError, match=r"GitHub GET git/ref/heads/main failed with HTTP 404") as error:
        api.request("git/ref/heads/main")

    assert "super-secret" not in str(error.value)

def test_qualify_child_pipeline_contains_release_preflight():
    plan = {**select("qualify", [], ref="main"), "sha": SHA, "parent_id": 1}
    config = render(plan)
    job = config["release-preflight"]
    assert job["environment"] == {"name": "release-public", "action": "verify"}
    assert job["artifacts"]["paths"] == ["release-preflight.json"]
    assert "release-preflight" not in render({**select("integration", [], ref="main"), "sha": SHA, "parent_id": 1})
