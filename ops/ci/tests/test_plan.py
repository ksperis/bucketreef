import json
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from plan import PUBLIC, changes, classify, select, version_values
from required import check


@pytest.mark.parametrize("path,expected,absent", [
    ("README.md", {"docs-build", "docs-screenshots"}, {"backend-tests", "build-backend"}),
    ("ops/release/prepare.py", {"backend-tests", "helm-contract"}, {"frontend-tests"}),
    ("ops/cron/run-billing.sh", {"build-scheduler", "compose-contract"}, {"build-frontend"}),
    ("backend/app/main.py", {"backend-tests", "backend-security-contract", "backend-postgresql-tests", "ceph-functional-tests", "build-frontend"}, {"build-scheduler"}),
    ("frontend/src/main.tsx", {"frontend-quality", "frontend-tests", "frontend-browser-e2e"}, {"ceph-functional-tests"}),
    ("frontend/scripts/docs-screenshots/check.mjs", {"docs-build", "frontend-quality"}, {"build-backend"}),
])
def test_dependencies(path, expected, absent):
    jobs = set(select("integration", [path])["jobs"])
    assert expected <= jobs
    assert not jobs & absent


@pytest.mark.parametrize("paths", [None, ["unknown/tool"], [".gitlab-ci.yml"], ["ops/ci/plan.py"]])
def test_conservative_fallback(paths):
    assert set(PUBLIC) <= set(select("pr", paths)["jobs"])


def test_fork_never_has_private_jobs_even_with_unknown_paths():
    plan = select("pr", None)
    assert plan["images"] == []
    assert set(plan["jobs"]) == set(PUBLIC)


@pytest.mark.parametrize("source,ref,protected,mode,tag", [
    ("merge_request_event", "main", True, "auto", ""),
    ("external_pull_request_event", "main", True, "auto", ""),
    ("push", "main", False, "auto", ""),
    ("push", "feature", True, "auto", ""),
    ("web", "dev", True, "qualify", ""),
    ("schedule", "main", True, "auto", ""),
    ("web", "main", True, "auto", "v1.2.3"),
    ("push", "main", True, "auto", "v1.2.3-rc1"),
])
def test_private_authority_rejected(source, ref, protected, mode, tag):
    with pytest.raises(ValueError):
        classify(source=source, ref=ref, protected=protected, mode=mode, tag=tag)


def test_profiles_are_disjoint():
    assert set(select("docs", None)["jobs"]) == {"docs-build", "docs-screenshots", "docs-deploy"}
    for profile in ("security", "secrets-history", "regression", "recover-release", "release", "bootstrap-release-bundles"):
        plan = select(profile, None)
        assert not plan["images"]
        assert "docs-deploy" not in plan["jobs"]
    assert select("integration", ["README.md"], version=True)["profile"] == "qualify"
    assert select("integration", ["README.md"], ref="dev", version=True)["profile"] == "integration"


@pytest.mark.parametrize("status", ["failure", "cancelled", "skipped", None, "neutral"])
def test_required_never_accepts_missing_or_non_success(status):
    expected = ["ci-contract", "project-naming", "secret-scan", "backend-tests"]
    needs = {name: {"result": "success"} for name in expected}
    needs["plan"] = {"result": "success", "outputs": {"jobs": json.dumps(expected)}}
    needs["backend-tests"]["result"] = status
    with pytest.raises(ValueError):
        check(needs)
    needs["backend-tests"]["result"] = "success"
    check(needs)
    needs["plan"]["result"] = status
    with pytest.raises(ValueError):
        check(needs)


def test_diff_includes_both_sides_of_rename_and_deleted_paths(tmp_path):
    def git(*args):
        return subprocess.check_output(["git", "-c", "user.name=CI", "-c", "user.email=ci@example.invalid", *args], cwd=tmp_path, text=True).strip()
    git("init", "-q")
    (tmp_path / "old name").write_text("data")
    git("add", ".")
    git("commit", "-qm", "initial")
    base = git("rev-parse", "HEAD")
    (tmp_path / "old name").rename(tmp_path / "new name")
    git("add", "-A")
    git("commit", "-qm", "rename")
    head = git("rev-parse", "HEAD")
    assert changes(base, head, root=tmp_path) == ["new name", "old name"]
    assert changes("0" * 40, head, root=tmp_path) is None
    assert changes("f" * 40, head, root=tmp_path) is None


def test_dependency_edit_is_not_necessarily_a_version_bump():
    assert version_values('{"version":"1.0.0","dependencies":{"x":"1"}}', "package.json") == version_values('{"version":"1.0.0","dependencies":{"x":"2"}}', "package.json")
