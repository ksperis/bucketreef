import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from plan import classify, select
from render_gitlab import render


def test_demo_bootstrap_is_explicit_and_does_not_enter_release_distribution():
    assert classify(source="web", ref="main", protected=True, mode="bootstrap-demo") == "bootstrap-demo"
    config = render({**select("bootstrap-demo", None), "sha": "a" * 40, "parent_id": 1})
    assert "frontend-demo" in config and "demo-bootstrap" in config
    assert "finalize-release" not in config and "demo-deploy" not in config


def test_demo_release_is_tested_before_finalization_and_published_afterwards():
    config = render({**select("prepare-release", None), "sha": "a" * 40, "parent_id": 1})
    assert "frontend-demo" in {item["job"] for item in config["release-ready"]["needs"]}
    assert {"frontend-demo", "finalize-release"} <= {item["job"] for item in config["demo-deploy"]["needs"]}
    assert config[".demo-publication"]["resource_group"] == "cloudflare-demo-production"
    assert config[".demo-publication"]["environment"]["name"] == "demo-production"


def test_tag_pipeline_still_only_verifies_release():
    config = render({**select("release", None), "sha": "a" * 40, "parent_id": 1})
    assert "demo-deploy" not in config and "demo-bootstrap" not in config and "frontend-demo" not in config


def test_frontend_changes_and_qualification_include_demo():
    assert "frontend-demo" in select("pr", ["frontend/src/api/portal.ts"])["jobs"]
    assert "frontend-demo" in select("qualify", None)["jobs"]
