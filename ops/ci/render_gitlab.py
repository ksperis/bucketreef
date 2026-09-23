"""Render one bounded child pipeline, with no optional validation dependencies."""
import base64
import copy
import json
from pathlib import Path

import yaml

from plan import ROOT
from toolchain import pin, TOOLS


def templates():
    return yaml.safe_load((ROOT / "ops/ci/gitlab/jobs.yml").read_text())


def render(plan):
    source = templates()
    names = set(plan["jobs"])
    profile = plan["profile"]
    if profile == "release":
        # The same list is checked against real GitLab job results before release.
        import sys
        sys.path.insert(0, str(ROOT / "ops/release"))
        from distribution import REQUIRED
        names = {*REQUIRED, "release-ready", "finalize-release"}
    elif profile == "recover-release":
        names = {"recover-gitlab-release"}
    elif profile == "release-history":
        names = {"publish-release-history"}
    elif profile == "bootstrap-release-bundles":
        names = {"bootstrap-release-bundles"}
    elif profile in {"integration", "qualify"}:
        names.add("integration-ready")
        if profile == "qualify" and plan["ref"] == "main":
            names.add("release-preflight")
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
        if name == "recover-gitlab-release" and plan.get("recovery_version"):
            job.setdefault("variables", {})["GITLAB_RELEASE_RECOVERY_VERSION"] = plan["recovery_version"]
        if job.get("extends") == "helm-kind-onboarding-smoke":
            job["extends"] = ".kind-base"
        if name == "publish-release-history":
            job.setdefault("variables", {})["RELEASE_HISTORY_APPLY"] = "true" if plan.get("history_apply") else "false"
        if name == "bootstrap-release-bundles":
            job.setdefault("variables", {})["BUNDLE_BOOTSTRAP_VERSION"] = plan["bootstrap_version"]
        dependencies = job.get("needs", [])
        if name.startswith("build-"):
            dependencies = sorted(set(plan["jobs"]) & {"backend-tests", "backend-security-contract", "backend-postgresql-tests", "backend-deadcode", "frontend-quality", "frontend-tests", "frontend-browser-e2e", "helm-contract", "compose-contract", "ci-contract", "project-naming", "secret-scan"})
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
        # Cache downloads only; never virtualenvs, node_modules or build outputs.
        caches = []
        if name in {"backend-tests", "backend-postgresql-tests", "backend-deadcode", "ceph-functional-tests", "frontend-browser-e2e", "docs-build", "ci-contract"}:
            import hashlib
            requirements = [*ROOT.glob("backend/requirements*.txt"), ROOT / "doc/requirements.txt", ROOT / "ops/ci/requirements.txt"]
            digest = hashlib.sha256(b"".join(p.read_bytes() for p in sorted(requirements))).hexdigest()[:20]
            caches.append({"key": f"trusted-pip-{TOOLS['python']}-{digest}", "paths": [".cache/pip/"]})
        if name in {"frontend-quality", "frontend-tests", "frontend-browser-e2e", "docs-deploy"}:
            lock = "ops/cloudflare/package-lock.json" if name == "docs-deploy" else "frontend/package-lock.json"
            caches.append({"key": {"prefix": f"trusted-npm-{TOOLS['node']}", "files": [lock]}, "paths": [".cache/npm/"]})
        if caches:
            job["cache"] = caches
        config[name] = job
    return pin(config)
