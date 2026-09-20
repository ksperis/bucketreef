"""Render one bounded child pipeline, with no optional validation dependencies."""
import base64
import copy
import json
from pathlib import Path

import yaml

from plan import ROOT


def templates():
    return yaml.safe_load((ROOT / "ops/ci/gitlab/jobs.yml").read_text())


def render(plan):
    source = templates()
    names = set(plan["jobs"])
    profile = plan["profile"]
    if profile == "release":
        names = {"release-tag-metadata", "release-source-images-ready", "release-bundles", "release-kind-onboarding-smoke", "release-bundle-smoke", "publish-helm-release", "publish-github-release", "publish-gitlab-release"}
        names.update(f"{c}-release-image-vuln-scan" for c in ("backend", "frontend", "scheduler"))
        names.update(f"promote-{c}-release" for c in ("backend", "frontend", "scheduler"))
    elif profile == "recover-release":
        names = {"recover-gitlab-release"}
    elif profile in {"integration", "qualify"}:
        names.add("integration-ready")
        if plan["ref"] == "dev":
            names.update(f"promote-{c}-dev" for c in plan["images"])
    payload = base64.b64encode(json.dumps(plan).encode()).decode()
    config = {
        "workflow": {"rules": [{"if": '$CI_PIPELINE_SOURCE == "parent_pipeline" && $CI_COMMIT_REF_PROTECTED == "true"'}, {"when": "never"}]},
        "stages": ["plan", "test", "build", "security", "promote", "deploy", "evidence", "finalize"],
        "default": {"interruptible": False, "retry": {"max": 1, "when": ["api_failure", "runner_system_failure", "stuck_or_timeout_failure"]}, "tags": ["bucketreef-protected"]},
        **yaml.safe_load((ROOT / "ops/ci/gitlab/variables.yml").read_text()),
        "pipeline-plan": {"stage": "plan", "image": "python:3.12-slim", "script": [f"python3 -c \"import base64; open('ci-plan.json','wb').write(base64.b64decode('{payload}'))\""], "artifacts": {"paths": ["ci-plan.json"]}},
    }
    # Extends may reference a concrete job (the release Kind variant).
    for name, value in source.items():
        if name.startswith("."):
            config[name] = copy.deepcopy(value)
    if "release-kind-onboarding-smoke" in names:
        config[".kind-base"] = copy.deepcopy(source["helm-kind-onboarding-smoke"])
        config[".kind-base"].pop("needs", None)
    for name in sorted(names):
        job = copy.deepcopy(source[name])
        if job.get("extends") == "helm-kind-onboarding-smoke":
            job["extends"] = ".kind-base"
        dependencies = job.get("needs", [])
        if name.startswith("build-"):
            dependencies = sorted(set(plan["jobs"]) & {"backend-tests", "backend-postgresql-tests", "backend-deadcode", "frontend-quality", "frontend-tests", "frontend-browser-e2e", "helm-contract", "compose-contract", "ci-contract", "project-naming", "secret-scan"})
        if name == "integration-ready":
            dependencies = plan["jobs"]
        if name.startswith("promote-") and name.endswith("-dev"):
            dependencies = ["integration-ready"]
            job["stage"] = "finalize"
            job["resource_group"] = "internal-dev-images"
        normalized = [{"job": item, "artifacts": True} if isinstance(item, str) else item for item in dependencies]
        for dependency in normalized:
            if dependency["job"] not in names or dependency.get("optional"):
                raise ValueError(f"Missing mandatory dependency: {name} -> {dependency['job']}")
        job["needs"] = [{"job": "pipeline-plan", "artifacts": True}, *normalized]
        job.pop("rules", None)
        job["allow_failure"] = False
        config[name] = job
    return config
