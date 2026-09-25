# Copyright (c) 2026 Laurent Barbe. Licensed under Apache-2.0.
from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
import sqlalchemy as sa

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/release"))
from check_version import check_version
from prepare import prepare
from publish_github_release import ensure_tag
from release_notes import changelog_section, previous_tag, render_notes
from schema_baseline import baseline, baseline_files, requires_baseline
from publish_gitlab_release import publish, resolve_git_tag
from recover_gitlab_release import recover, verify_public_release
from app.db import Base


@pytest.mark.parametrize("text", ["## 1.2.4\n- Wrong version", "## 1.2.3\n### Added\n", "## 1.2.3\n- One\n## 1.2.3\n- Two\n"])
def test_missing_empty_and_duplicate_changelog_sections_fail(text):
    with pytest.raises(ValueError):
        changelog_section(text, "1.2.3")


def test_changelog_section_is_preserved_and_compare_is_platform_specific():
    section = "## 1.2.3 - 2026-09-20\n\n### Fixed\n\n- Preserve `literal` content.\n"
    assert changelog_section("# Changelog\n\n" + section + "\n## 1.2.2\n- Old\n", "1.2.3") == section
    github = render_notes(section, "1.2.3", "v1.2.2", "https://github.com/org/repo")
    gitlab = render_notes(section, "1.2.3", "v1.2.2", "https://gitlab.example/org/repo", gitlab=True)
    assert github.startswith(section) and gitlab.startswith(section)
    assert "/compare/v1.2.2...v1.2.3" in github
    assert "/-/compare/v1.2.2...v1.2.3" in gitlab


def test_previous_release_is_numeric_stable_and_reachable(tmp_path):
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=tmp_path, text=True).strip()
    git("init", "--quiet")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "initial")
    for tag in ("v1.2.9", "v1.2.10", "v1.3.0-rc1", "v9.0.0"):
        git("tag", tag)
    original = git("rev-parse", "HEAD")
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "future")
    git("tag", "v1.2.11")
    assert previous_tag(tmp_path, "1.3.0", original) == "v1.2.10"


def test_patch_preparation_synchronizes_metadata_without_baseline(tmp_path):
    for relative in ("frontend/package.json", "frontend/package-lock.json", "deploy/helm/bucketreef/Chart.yaml", "deploy/compose/.env.example"):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, target)
    (tmp_path / "CHANGELOG.md").write_text("## 0.2.5 - 2026-09-20\n\n- Release fixture.\n")
    prepare(tmp_path, "0.2.5")
    check_version(tmp_path, "0.2.5")
    assert not (tmp_path / "backend/schema-baselines").exists()
    (tmp_path / "deploy/compose/.env.example").write_text("BUCKETREEF_TAG=0.2.4\n")
    with pytest.raises(ValueError, match="mismatch"):
        check_version(tmp_path, "0.2.5")


def test_baselines_are_deterministic_and_immutable(tmp_path):
    assert requires_baseline("0.3.1")
    assert not requires_baseline("0.2.5")
    assert not requires_baseline("1.3.1")
    with pytest.raises(ValueError, match="missing"):
        baseline(ROOT, "0.3.1", check=True, destination=tmp_path / "0.3.1")
    baseline(ROOT, "0.3.1", check=False, destination=tmp_path / "0.3.1")
    baseline(ROOT, "0.3.1", check=True, destination=tmp_path / "0.3.1")
    assert baseline_files(ROOT, "0.3.1") == baseline_files(ROOT, "0.3.1")
    manifest = json.loads((tmp_path / "0.3.1/manifest.json").read_text())
    assert manifest["version"] == "0.3.1"
    assert manifest["alembic_revision"]
    (tmp_path / "0.3.1/sqlite.sql").write_text("changed")
    with pytest.raises(ValueError, match="refusing to overwrite"):
        baseline(ROOT, "0.3.1", check=False, destination=tmp_path / "0.3.1")


def test_sqlite_snapshot_builds_the_current_schema(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path / 'snapshot.db'}")
    raw = engine.raw_connection()
    try:
        raw.executescript(baseline_files(ROOT, "0.3.1")["sqlite.sql"].decode())
        raw.commit()
    finally:
        raw.close()
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection, opts={"compare_type": True}), Base.metadata) == []
    engine.dispose()


class GitLabFixture:
    def __init__(self):
        self.release = None
        self.sha = "a" * 40
        self.tag_name = "v0.2.5"
        self.writes = []

    def request(self, path, *, method="GET", data=None, **kwargs):
        assert not path.startswith("repository/tags")
        if method == "GET":
            return self.release
        self.writes.append(data)
        self.release = {**data, "commit": {"id": self.sha}, "_links": {"self": "https://gitlab.example/release"}}
        return self.release


def test_gitlab_release_retry_is_read_only_and_conflicts_fail(monkeypatch):
    api = GitLabFixture()
    monkeypatch.setattr("publish_gitlab_release.resolve_git_tag", lambda *args, **kwargs: api.sha)
    publish(api, "0.2.5", "a" * 40, "Notes\n")
    assert len(api.writes) == 1 and len(api.release["assets"]["links"]) == 4
    publish(api, "0.2.5", "a" * 40, "Notes\n")
    assert len(api.writes) == 1
    with pytest.raises(RuntimeError, match="differs"):
        publish(api, "0.2.5", "a" * 40, "Other notes\n")
    api.sha = "b" * 40
    with pytest.raises(RuntimeError, match="SHA differs"):
        publish(api, "0.2.5", "a" * 40, "Notes\n")
    assert len(api.writes) == 1


def test_gitlab_release_creates_missing_tag_at_validated_sha(monkeypatch):
    api = GitLabFixture()
    resolved = iter([None, api.sha])
    monkeypatch.setattr("publish_gitlab_release.resolve_git_tag", lambda *args, **kwargs: next(resolved))
    publish(api, "0.2.5", api.sha, "Notes\n")
    assert api.writes[0]["ref"] == api.sha
    assert api.writes[0]["tag_name"] == "v0.2.5"


def test_github_tag_creation_is_idempotent_and_refuses_conflicts():
    class GitHubTagFixture:
        def __init__(self):
            self.sha = None
            self.writes = []

        def request(self, path, *, method="GET", data=None, missing_ok=False, **kwargs):
            if path == "git/ref/tags/v0.2.5":
                if self.sha is None and missing_ok:
                    return None
                return {"object": {"type": "commit", "sha": self.sha}}
            assert path == "git/refs" and method == "POST"
            self.writes.append(data)
            self.sha = data["sha"]
            return {"ref": data["ref"], "object": {"type": "commit", "sha": self.sha}}

    api = GitHubTagFixture()
    sha = "a" * 40
    ensure_tag(api, "v0.2.5", sha)
    ensure_tag(api, "v0.2.5", sha)
    assert api.writes == [{"ref": "refs/tags/v0.2.5", "sha": sha}]
    api.sha = "b" * 40
    with pytest.raises(RuntimeError, match="another commit"):
        ensure_tag(api, "v0.2.5", sha)


@pytest.mark.parametrize("annotated", [False, True])
def test_gitlab_release_requires_the_exact_existing_remote_tag(tmp_path, annotated):
    def git(*args):
        return subprocess.check_output(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *args], cwd=tmp_path, text=True).strip()
    git("init", "--quiet")
    git("commit", "--allow-empty", "-m", "initial")
    sha = git("rev-parse", "HEAD")
    git("tag", "v0.2.50")
    with pytest.raises(RuntimeError, match="existing GitLab release tag"):
        resolve_git_tag("0.2.5", root=tmp_path, remote=str(tmp_path))
    git("tag", "-a", "v0.2.5", "-m", "release") if annotated else git("tag", "v0.2.5")
    assert resolve_git_tag("0.2.5", root=tmp_path, remote=str(tmp_path)) == sha
    api = GitLabFixture()
    with pytest.raises(RuntimeError, match="SHA differs"):
        publish(api, "0.2.5", "a" * 40, "Notes", root=tmp_path, remote=str(tmp_path))
    assert not api.writes


class PublicReleaseFixture:
    def __init__(self, sha, notes):
        import hashlib
        from publish_github_release import ASSETS, REPOSITORY
        self.sha = sha
        self.files = {}
        self.release = {"draft": False, "prerelease": False, "tag_name": "v0.2.5", "name": "v0.2.5", "body": notes, "assets": []}
        for name in ASSETS:
            url = f"https://github.com/{REPOSITORY}/releases/download/v0.2.5/{name}"
            data = f"{hashlib.sha256(b'archive').hexdigest()}  {name.removesuffix('.sha256')}\n".encode() if name.endswith(".sha256") else b"archive"
            self.files[url] = data
            self.release["assets"].append({"name": name, "browser_download_url": url, "state": "uploaded", "size": len(data), "digest": "sha256:" + hashlib.sha256(data).hexdigest()})

    def request(self, path):
        if path.startswith("git/ref/"):
            return {"object": {"type": "commit", "sha": self.sha}}
        return self.release

    def download(self, url):
        return self.files[url]


@pytest.mark.parametrize("failure", ["draft", "notes", "missing", "digest", "download", "tag"])
def test_recovery_refuses_incomplete_or_divergent_github_releases(failure):
    api = PublicReleaseFixture("a" * 40, "Notes")
    if failure == "draft":
        api.release["draft"] = True
    elif failure == "notes":
        api.release["body"] = "different"
    elif failure == "missing":
        api.release["assets"].pop()
    elif failure == "digest":
        api.release["assets"][0]["digest"] = "sha256:wrong"
    elif failure == "download":
        api.files[next(iter(api.files))] = b"corrupt"
    elif failure == "tag":
        api.sha = "b" * 40
    with pytest.raises(RuntimeError):
        verify_public_release(api, "0.2.5", "a" * 40, "Notes")


def test_recovery_uses_tagged_changelog_and_is_idempotent(tmp_path):
    def git(*args):
        return subprocess.check_output(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *args], cwd=tmp_path, text=True).strip()
    git("init", "--quiet")
    section = "## 0.2.5\n\n- Original release.\n"
    (tmp_path / "CHANGELOG.md").write_text(section)
    git("add", "CHANGELOG.md")
    git("commit", "-m", "release")
    git("tag", "v0.2.4")
    git("tag", "v0.2.5")
    sha = git("rev-parse", "HEAD")
    (tmp_path / "CHANGELOG.md").write_text("## 0.2.6\n- Future release\n")
    git("commit", "-am", "future")
    api = GitLabFixture()
    api.sha = sha
    github = PublicReleaseFixture(sha, render_notes(section, "0.2.5", "v0.2.4", "https://github.com/ksperis/bucketreef"))
    for _ in range(2):
        recover(api, github, "0.2.5", "https://gitlab.example/repo", root=tmp_path, remote=str(tmp_path))
    assert len(api.writes) == 1
    assert "Original release" in api.release["description"]
    assert "/-/compare/v0.2.4...v0.2.5" in api.release["description"]
