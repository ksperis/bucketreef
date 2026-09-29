import subprocess

import pytest

from secret_scope import scope


def test_exact_scan_scope_includes_both_sides_of_a_merge(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    def git(*args):
        return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL).strip()

    git("init", "-b", "main")
    git("config", "user.name", "CI test")
    git("config", "user.email", "ci@example.invalid")

    def commit(name):
        (tmp_path / name).write_text(name)
        git("add", name)
        git("commit", "-m", name)
        return git("rev-parse", "HEAD")

    base = commit("base")
    git("checkout", "-b", "feature")
    feature = commit("feature")
    git("checkout", "main")
    main = commit("main")
    git("merge", "--no-ff", "feature", "-m", "merge")
    head = git("rev-parse", "HEAD")
    record = scope({"profile": "qualify", "base_sha": base, "sha": head})
    assert record["commits"] == sorted([feature, main, head])
    assert record["commits"] == sorted(git("rev-list", f"{base}..{head}").splitlines())

    # An analyzer-induced shallow boundary must invalidate the proof, even when
    # the base and head objects themselves are still present in the object store.
    (tmp_path / ".git/shallow").write_text(main + "\n")
    with pytest.raises(ValueError, match="complete Git history"):
        scope({"profile": "qualify", "base_sha": base, "sha": head})
