#!/usr/bin/env python3
"""Read-only checks proving that a qualified main SHA is ready to be tagged."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ops/ci"))

from gitlab_api import GitLabAPI  # noqa: E402
from check_version import check_version  # noqa: E402
from publish_github_release import GitHub  # noqa: E402
from schema_baseline import baseline  # noqa: E402


GHCR_REPOSITORIES = (
    "ghcr.io/ksperis/bucketreef-backend",
    "ghcr.io/ksperis/bucketreef-frontend",
    "ghcr.io/ksperis/bucketreef-scheduler",
    "ghcr.io/ksperis/charts/bucketreef",
    "ghcr.io/ksperis/bucketreef-bundles",
)
ANONYMOUS_REPOSITORIES = (
    "ghcr.io/ksperis/charts/bucketreef",
    "ghcr.io/ksperis/bucketreef-bundles",
)
REQUIRED_ENV = (
    "GITLAB_CI_READ_API_TOKEN",
    "GITHUB_RELEASE_TOKEN",
    "GHCR_USERNAME",
    "GHCR_TOKEN",
)


def _oras_tags(repository: str, *, username: str | None = None,
               token: str | None = None, registry_config: Path | None = None) -> list[str]:
    command = ["oras", "repo", "tags"]
    if registry_config is not None:
        command.extend(("--registry-config", str(registry_config)))
    input_data = None
    if username is not None and token is not None:
        command.extend(("--username", username, "--password-stdin"))
        input_data = token.encode()
    command.append(repository)
    result = subprocess.run(command, input=input_data, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f"GHCR access failed for {repository}")
    tags = [line.strip() for line in result.stdout.decode().splitlines() if line.strip()]
    if not tags:
        raise RuntimeError(f"GHCR package has no visible tags: {repository}")
    return tags


def _version(root: Path) -> str:
    value = json.loads((root / "frontend/package.json").read_text())["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value):
        raise ValueError("Prepared application version must be X.Y.Z")
    check_version(root, value)
    baseline(root, value, check=True)
    return value


def run(*, root: Path = ROOT, env=None, gitlab=None, github=None) -> dict:
    env = os.environ if env is None else env
    record = {
        "schema": 1,
        "sha": env.get("CI_COMMIT_SHA", ""),
        "ref": env.get("CI_COMMIT_BRANCH", ""),
        "status": "failed",
        "checks": {},
    }
    failures = []

    def check(name, action):
        try:
            detail = action()
            record["checks"][name] = {"status": "success", **(detail or {})}
        except (KeyError, OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
            record["checks"][name] = {"status": "failed", "error": str(error)[:300]}
            failures.append(f"{name}: {error}")

    def required_variables():
        missing = [name for name in REQUIRED_ENV if not env.get(name)]
        if missing:
            raise ValueError("Missing required variables: " + ", ".join(missing))
        return {"variables": list(REQUIRED_ENV)}

    check("release-variables", required_variables)

    sha = env.get("CI_COMMIT_SHA", "")
    if env.get("CI_COMMIT_BRANCH") != "main" or not re.fullmatch(r"[0-9a-f]{40}", sha):
        failures.append("main-sha: preflight requires a full SHA on main")
        record["checks"]["main-sha"] = {"status": "failed", "error": "Preflight requires a full SHA on main"}
    else:
        def remote_main():
            gitlab_api = gitlab or GitLabAPI()
            github_api = github or GitHub(env.get("GITHUB_RELEASE_TOKEN", ""))
            gitlab_sha = gitlab_api.get("repository/branches/main")["commit"]["id"]
            repo = github_api.request("")
            permissions = repo.get("permissions", {})
            if not permissions.get("push"):
                raise RuntimeError("GitHub token cannot write repository contents")
            github_sha = github_api.request("git/ref/heads/main")["object"]["sha"]
            if gitlab_sha != sha or github_sha != sha:
                raise RuntimeError("main differs between the qualified SHA, GitLab and GitHub")
            return {"gitlab_sha": gitlab_sha, "github_sha": github_sha}

        check("remote-main", remote_main)

    check("release-metadata", lambda: {"version": _version(root)})

    if all(env.get(name) for name in ("GHCR_USERNAME", "GHCR_TOKEN")):
        def authenticated_packages():
            for repository in GHCR_REPOSITORIES:
                _oras_tags(repository, username=env["GHCR_USERNAME"], token=env["GHCR_TOKEN"])
            return {"repositories": list(GHCR_REPOSITORIES)}

        check("ghcr-authenticated", authenticated_packages)

        def anonymous_packages():
            with tempfile.TemporaryDirectory() as temporary:
                config = Path(temporary) / "config.json"
                config.write_text('{"auths":{}}\n')
                for repository in ANONYMOUS_REPOSITORIES:
                    _oras_tags(repository, registry_config=config)
            return {"repositories": list(ANONYMOUS_REPOSITORIES)}

        check("ghcr-anonymous", anonymous_packages)
    else:
        for name in ("ghcr-authenticated", "ghcr-anonymous"):
            record["checks"][name] = {"status": "failed", "error": "GHCR credentials are unavailable"}
            failures.append(f"{name}: GHCR credentials are unavailable")

    if failures:
        record["error"] = "; ".join(failures)[:1000]
    else:
        record["status"] = "success"
    return record


def main() -> int:
    output = ROOT / "release-preflight.json"
    record = run()
    output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    if record["status"] != "success":
        print(f"Release preflight failed: {record['error']}", file=sys.stderr)
        return 1
    print(f"Release preflight passed for {record['sha']} ({record['checks']['release-metadata']['version']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
