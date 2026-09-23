#!/usr/bin/env python3
"""Platform-neutral impact policy. Unknown/incomplete input expands validation."""
from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = ("backend", "frontend", "scheduler")
PUBLIC = (
    "project-naming", "ci-contract", "secret-scan", "backend-tests",
    "backend-postgresql-tests", "backend-deadcode", "backend-vuln-scan",
    "frontend-quality", "frontend-tests", "frontend-browser-e2e",
    "frontend-vuln-scan", "helm-contract", "compose-contract", "docs-build",
    "docs-screenshots", "scheduler-contract",
)
BACKEND = {"backend-tests", "backend-postgresql-tests", "backend-deadcode"}
FRONTEND = {"frontend-quality", "frontend-tests"}
DOCS = {"docs-build", "docs-screenshots"}
DEPLOY = {"backend-tests", "helm-contract", "compose-contract"}
VERSION_FILES = ("frontend/package.json", "frontend/package-lock.json",
                 "deploy/helm/bucketreef/Chart.yaml", "deploy/compose/.env.example")


def git(*args: str, root: Path = ROOT) -> str:
    return subprocess.check_output(["git", *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()


def changes(base: str | None, head: str, *, root: Path = ROOT) -> list[str] | None:
    if not base or not re.fullmatch(r"[0-9a-f]{40}", base) or base == "0" * 40:
        return None
    try:
        # No rename detection: both removed and added paths must contribute.
        git("merge-base", "--is-ancestor", base, head, root=root)
        raw = subprocess.check_output(["git", "diff", "--name-only", "--no-renames", "-z", base, head, "--"], cwd=root)
        return sorted({p.decode("utf-8") for p in raw.split(b"\0") if p})
    except (subprocess.CalledProcessError, UnicodeDecodeError):
        return None


def version_values(text: str, path: str) -> tuple:
    if path.endswith(".json"):
        value = json.loads(text)
        return value.get("version"), value.get("packages", {}).get("", {}).get("version")
    if path.endswith("Chart.yaml"):
        return tuple(re.findall(r"(?m)^(?:version|appVersion):\s*(.+)$", text))
    return tuple(re.findall(r"(?m)^BUCKETREEF_TAG=(.*)$", text))


def version_changed(base: str | None, head: str, paths: list[str] | None, *, root: Path = ROOT) -> bool:
    if paths is None:
        return True
    for path in set(paths) & set(VERSION_FILES):
        try:
            if version_values(git("show", f"{base}:{path}", root=root), path) != version_values(git("show", f"{head}:{path}", root=root), path):
                return True
        except (subprocess.CalledProcessError, ValueError):
            return True
    return False


def classify(*, source: str, ref: str, protected: bool, mode: str = "auto", tag: str = "") -> str:
    if not protected:
        raise ValueError("Private pipelines require a protected reference")
    if tag:
        if source != "push" or mode != "auto" or not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
            raise ValueError("Only stable protected push tags can publish")
        return "release"
    if ref not in {"main", "dev"}:
        raise ValueError("Private pipelines require main or dev")
    if source == "push" and mode == "auto":
        return "integration"
    if source == "web" and ref == "main" and mode in {"qualify", "docs", "recover-release", "release-history", "bootstrap-release-bundles"}:
        return mode
    if source == "schedule" and ref == "main" and mode in {"regression", "security", "secrets-history"}:
        return mode
    raise ValueError("Unsupported pipeline source/profile")


def select(profile: str, paths: list[str] | None, *, ref: str = "main", version: bool = False) -> dict:
    if profile not in {"pr", "integration", "qualify", "release", "docs", "regression", "security", "secrets-history", "recover-release", "release-history", "bootstrap-release-bundles"}:
        raise ValueError("Unknown CI profile")
    if profile == "integration" and ref == "main" and version:
        profile = "qualify"
    selected = {"project-naming", "ci-contract", "secret-scan"}
    images: set[str] = set()
    ceph = False
    reasons: dict[str, list[str]] = {}

    def add(jobs, reason):
        selected.update(jobs)
        for job in jobs:
            reasons.setdefault(job, []).append(reason)

    full = paths is None or profile in {"qualify", "regression"}
    for path in paths or []:
        if path.startswith((".github/", "ops/ci/")) or path in {".gitlab-ci.yml", ".trivyignore", "pytest.ini"}:
            full = True
        elif path.startswith(("doc/", "ops/cloudflare/")) or path == "README.md":
            add(DOCS, path)
        elif path.startswith("frontend/scripts/docs-screenshots/") or path.startswith("frontend/playwright.docs"):
            add(DOCS | FRONTEND, path)
        elif path.startswith("backend/"):
            add(BACKEND, path)
            if path.startswith(("backend/app/", "backend/alembic/")) or "requirements" in path or path.endswith("Dockerfile"):
                add({"frontend-browser-e2e"}, path)
                images.add("backend")
                ceph = True
            if "requirements" in path:
                add({"backend-vuln-scan"}, path)
            if path.startswith("backend/tests_ceph_functional/"):
                ceph = True
        elif path.startswith("frontend/"):
            add(FRONTEND | {"frontend-browser-e2e"}, path)
            images.add("frontend")
            if path.endswith(("package.json", "package-lock.json")):
                add({"frontend-vuln-scan", "backend-tests"}, path)
        elif path.startswith(("ops/release/", "deploy/")) or path in {"CHANGELOG.md", "docker-compose.yml"}:
            add(DEPLOY, path)
            if path.startswith("deploy/") or path == "docker-compose.yml":
                images.update(("backend", "frontend"))
        elif path.startswith(("ops/cron/", "scheduler/")):
            add(DEPLOY | {"scheduler-contract"}, path)
            images.add("scheduler")
        elif path in {"AGENTS.md", "LICENSE", ".gitignore", ".gitmessage-ai.txt"} or path.startswith(".vscode/"):
            pass
        else:
            full = True
    if full:
        add(PUBLIC, "full validation: profile, CI change, unknown path or unavailable baseline")
        images.update(COMPONENTS)
        ceph = True
    if profile == "docs":
        selected, images, ceph = set(DOCS), set(), False
    elif profile == "security":
        selected, images, ceph = {"backend-vuln-scan", "frontend-vuln-scan", "secret-scan", "scan-published-images"}, set(), False
    elif profile == "secrets-history":
        selected, images, ceph = {"secret-scan"}, set(), False
    elif profile in {"release", "recover-release", "release-history", "bootstrap-release-bundles"}:
        selected, images, ceph = set(), set(), False
    if profile == "pr":
        images, ceph = set(), False
    elif profile == "regression":
        images = set()  # Scheduled regression never creates official artifacts.
    if images & {"backend", "frontend"}:
        images.update(("backend", "frontend"))  # Kind tests the exact pair at this SHA.
        selected.add("helm-kind-onboarding-smoke")
    for component in images:
        selected.update((f"build-{component}", f"{component}-image-vuln-scan"))
    if ceph:
        selected.add("ceph-functional-tests")
    if profile in {"integration", "docs"} and ref == "main" and DOCS <= selected:
        selected.add("docs-deploy")
    for job in selected:
        reasons.setdefault(job, ["mandatory policy or dependency for " + profile])
    reasons = {job: reasons[job] for job in sorted(selected)}
    return {"schema": 1, "profile": profile, "ref": ref, "jobs": sorted(selected),
            "images": sorted(images), "reasons": reasons, "full": full}


def require_results(expected: list[str], results: dict) -> None:
    failures = [name for name in expected if results.get(name) != "success"]
    if failures:
        raise ValueError("Required validations did not succeed: " + ", ".join(failures))
