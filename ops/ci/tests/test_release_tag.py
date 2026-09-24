from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ops/release"))

import tag as release_tag


SHA = "a" * 40
OTHER = "b" * 40
VERSION = "0.2.7"
TAG = f"v{VERSION}"
TAG_REF = f"refs/tags/{TAG}"


class FakeGit:
    def __init__(self, *, github_main=SHA, gitlab_main=SHA, github_tag=None, gitlab_tag=None):
        self.local_tag = None
        self.remote = {
            "github": {"refs/heads/main": github_main, TAG_REF: github_tag},
            "gitlab": {"refs/heads/main": gitlab_main, TAG_REF: gitlab_tag},
        }
        self.pushes = []

    def __call__(self, *args, root=ROOT, check=True):
        if args == ("branch", "--show-current"):
            return "main"
        if args == ("rev-parse", "HEAD"):
            return SHA
        if args == ("rev-parse", "--verify", f"{TAG}^{{commit}}"):
            return self.local_tag or ""
        if args[:4] == ("diff", "--name-only", "HEAD", "--"):
            return ""
        if args[0] == "ls-remote":
            remote, ref = args[1], args[2]
            value = self.remote[remote].get(ref)
            return f"{value}\t{ref}" if value else ""
        if args[0] == "tag":
            assert args == ("tag", TAG, SHA)
            self.local_tag = SHA
            return ""
        if args[0] == "push":
            remote = args[1]
            assert args[2] == f"{TAG_REF}:{TAG_REF}"
            self.remote[remote][TAG_REF] = self.local_tag
            self.pushes.append(remote)
            return ""
        raise AssertionError(args)


def prepare(monkeypatch, fake):
    monkeypatch.setattr(release_tag, "git", fake)
    monkeypatch.setattr(release_tag, "check_version", lambda *args: None)
    monkeypatch.setattr(release_tag, "baseline", lambda *args, **kwargs: None)


def test_tag_pushes_github_then_gitlab_and_is_idempotent(monkeypatch):
    fake = FakeGit()
    prepare(monkeypatch, fake)

    assert release_tag.tag(VERSION) == SHA
    assert fake.pushes == ["github", "gitlab"]
    assert release_tag.tag(VERSION) == SHA
    assert fake.pushes == ["github", "gitlab"]


def test_tag_resumes_when_github_already_has_same_tag(monkeypatch):
    fake = FakeGit(github_tag=SHA)
    prepare(monkeypatch, fake)

    release_tag.tag(VERSION)

    assert fake.pushes == ["gitlab"]


def test_tag_refuses_remote_tag_conflict(monkeypatch):
    fake = FakeGit(github_tag=OTHER)
    prepare(monkeypatch, fake)

    with pytest.raises(RuntimeError, match="refusing to move"):
        release_tag.tag(VERSION)
    assert fake.pushes == []


def test_tag_refuses_unsynchronized_main(monkeypatch):
    fake = FakeGit(github_main=OTHER)
    prepare(monkeypatch, fake)

    with pytest.raises(RuntimeError, match="HEAD must match main"):
        release_tag.tag(VERSION)
    assert fake.pushes == []
