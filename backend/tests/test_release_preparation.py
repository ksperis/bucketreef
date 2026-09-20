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
from release_notes import changelog_section, previous_tag, render_notes
from schema_baseline import baseline, baseline_files, requires_baseline
from publish_gitlab_release import publish
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
        self.writes = []

    def request(self, path, *, method="GET", data=None, **kwargs):
        if path.startswith("repository/tags/"):
            return {"commit": {"id": self.sha}}
        if method == "GET":
            return self.release
        self.writes.append(data)
        self.release = {**data, "commit": {"id": self.sha}, "_links": {"self": "https://gitlab.example/release"}}
        return self.release


def test_gitlab_release_retry_is_read_only_and_conflicts_fail():
    api = GitLabFixture()
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
