"""Emit only allowlisted facts when the secret analyzer cannot complete."""
import json
from pathlib import Path
import re
import subprocess
import sys


ERROR_MARKERS = {
    "git_revision_unavailable": ("bad revision", "unknown revision", "ambiguous argument", "bad object"),
    "git_fetch_failed": ("fetch failed", "failed to fetch", "could not fetch", "unable to fetch"),
    "git_unsafe_repository": ("dubious ownership", "unsafe repository"),
    "git_repository_missing": ("not a git repository",),
    "authentication_failed": ("authentication failed", "access denied", "could not read username"),
    "certificate_failed": ("certificate verify failed", "unknown authority", "ssl certificate"),
    "network_failed": ("could not resolve", "connection refused", "connection reset", "network is unreachable"),
    "permission_denied": ("permission denied",),
    "timeout": ("timed out", "deadline exceeded",),
    "gitleaks_failed": ("gitleaks analysis failed", "couldn't run the gitleaks command"),
    "report_failed": ("failed to write", "failed to convert", "unable to write"),
}


def diagnose(log: str, plan: dict) -> dict:
    lower = log.lower()
    revisions = {}
    for name in ("base_sha", "sha"):
        value = plan.get(name, "")
        revisions[name] = bool(re.fullmatch(r"[0-9a-f]{40}", value)) and subprocess.run(
            ["git", "cat-file", "-e", f"{value}^{{commit}}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        ).returncode == 0
    return {
        "schema": 1,
        "error_categories": [name for name, markers in ERROR_MARKERS.items() if any(marker in lower for marker in markers)],
        "git_revisions_available": revisions,
        "report_present": Path("gl-secret-detection-report.json").is_file(),
    }


if __name__ == "__main__":
    result = diagnose(Path(sys.argv[1]).read_text(errors="replace"), json.loads(Path("ci-plan.json").read_text()))
    Path("gl-security-reports").mkdir(exist_ok=True)
    Path("gl-security-reports/secret-analyzer-diagnostics.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
