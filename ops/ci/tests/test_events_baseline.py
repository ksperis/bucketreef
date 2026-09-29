from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ops/ci"))

import events
import gitlab_api


SHA = "b" * 40
PARENT = "a" * 40


def qualify_env():
    return {
        "CI_COMMIT_BRANCH": "main",
        "CI_PIPELINE_SOURCE": "web",
        "CI_COMMIT_REF_PROTECTED": "true",
        "CI_MODE": "qualify",
        "CI_COMMIT_TAG": "",
        "CI_COMMIT_SHA": SHA,
        "CI_PIPELINE_ID": "42",
    }


def resume_env():
    return {
        **qualify_env(),
        "CI_MODE": "resume-release",
        "RELEASE_RECOVERY_VERSION": "0.2.10",
        "RELEASE_RECOVERY_PIPELINE_ID": "583",
    }


def test_manual_qualify_uses_latest_baseline(monkeypatch):
    baseline = "c" * 40
    monkeypatch.setattr(gitlab_api, "latest_baseline", lambda api, ref: baseline)
    monkeypatch.setattr(events, "git", lambda *args: SHA if args == ("rev-parse", "HEAD") else (_ for _ in ()).throw(AssertionError(args)))
    monkeypatch.setattr(events, "changes", lambda base, head: [] if (base, head) == (baseline, SHA) else None)

    plan = events.gitlab_plan(qualify_env(), api=object())

    assert plan["profile"] == "qualify"
    assert plan["base_sha"] == baseline


def test_manual_qualify_falls_back_to_parent_when_no_baseline_exists(monkeypatch):
    monkeypatch.setattr(gitlab_api, "latest_baseline", lambda api, ref: None)

    def fake_git(*args):
        if args == ("rev-parse", "HEAD"):
            return SHA
        if args == ("rev-parse", f"{SHA}^"):
            return PARENT
        raise AssertionError(args)

    monkeypatch.setattr(events, "git", fake_git)
    monkeypatch.setattr(events, "changes", lambda base, head: [] if (base, head) == (PARENT, SHA) else None)

    plan = events.gitlab_plan(qualify_env(), api=object())

    assert plan["base_sha"] == PARENT


def test_resume_release_carries_strict_recovery_inputs(monkeypatch):
    monkeypatch.setattr(events, "git", lambda *args: SHA if args == ("rev-parse", "HEAD") else (_ for _ in ()).throw(AssertionError(args)))

    plan = events.gitlab_plan(resume_env(), api=object())

    assert plan["profile"] == "resume-release"
    assert plan["recovery_version"] == "0.2.10"
    assert plan["recovery_pipeline_id"] == 583


@pytest.mark.parametrize(
    "key,value",
    [
        ("RELEASE_RECOVERY_VERSION", "0.2"),
        ("RELEASE_RECOVERY_PIPELINE_ID", "0"),
        ("RELEASE_RECOVERY_PIPELINE_ID", "abc"),
    ],
)
def test_resume_release_rejects_invalid_recovery_inputs(monkeypatch, key, value):
    monkeypatch.setattr(events, "git", lambda *args: SHA if args == ("rev-parse", "HEAD") else (_ for _ in ()).throw(AssertionError(args)))
    env = resume_env()
    env[key] = value

    with pytest.raises(ValueError):
        events.gitlab_plan(env, api=object())
