from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "release"))
import resume_release


def test_recovery_inputs_are_strict(monkeypatch):
    monkeypatch.setenv("RELEASE_RECOVERY_VERSION", "0.2.10")
    monkeypatch.setenv("RELEASE_RECOVERY_PIPELINE_ID", "583")
    assert resume_release._version() == "0.2.10"
    assert resume_release._source_pipeline_id() == 583

    monkeypatch.setenv("RELEASE_RECOVERY_VERSION", "0.2")
    with pytest.raises(ValueError):
        resume_release._version()
    monkeypatch.setenv("RELEASE_RECOVERY_VERSION", "0.2.10")
    monkeypatch.setenv("RELEASE_RECOVERY_PIPELINE_ID", "0")
    with pytest.raises(ValueError):
        resume_release._source_pipeline_id()


def test_recovery_history_allows_only_release_and_ci_paths(monkeypatch):
    monkeypatch.setattr(
        resume_release.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0),
    )
    monkeypatch.setattr(
        resume_release.subprocess,
        "check_output",
        lambda *args, **kwargs: b"ops/ci/job.sh\0ops/release/recover.py\0.gitlab-ci.yml\0doc/docs/developer/releases.md\0",
    )
    paths = resume_release._validate_recovery_paths("a" * 40, "b" * 40)
    assert "ops/ci/job.sh" in paths

    monkeypatch.setattr(
        resume_release.subprocess,
        "check_output",
        lambda *args, **kwargs: b"frontend/src/main.tsx\0",
    )
    with pytest.raises(ValueError, match="product changes"):
        resume_release._validate_recovery_paths("a" * 40, "b" * 40)


def test_recovery_history_requires_prepared_commit_ancestry(monkeypatch):
    monkeypatch.setattr(
        resume_release.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=1),
    )
    with pytest.raises(ValueError, match="descend"):
        resume_release._validate_recovery_paths("a" * 40, "b" * 40)
