"""Verify the scanner retains the exact planned commit set, including merge sides."""
import json
from pathlib import Path
import shlex
import subprocess
import sys

from plan import secret_scan_options


def scope(plan):
    if subprocess.check_output(["git", "rev-parse", "--is-shallow-repository"], text=True).strip() != "false":
        raise ValueError("Secret scan requires complete Git history")
    options, _ = secret_scan_options(plan)
    if plan["profile"] != "secrets-history":
        subprocess.run(["git", "merge-base", "--is-ancestor", plan["base_sha"], plan["sha"]], check=True)
    commits = subprocess.check_output(["git", "rev-list", *shlex.split(options)], text=True).splitlines()
    return {"schema": 1, "sha": plan["sha"], "base_sha": plan.get("base_sha"), "commits": sorted(commits)}


if __name__ == "__main__":
    action, filename = sys.argv[1:]
    current = scope(json.loads(Path("ci-plan.json").read_text()))
    if action == "capture":
        Path(filename).write_text(json.dumps(current))
    elif action == "verify":
        if current != json.loads(Path(filename).read_text()):
            raise ValueError("Secret analyzer changed the planned commit set")
        Path("gl-security-reports").mkdir(exist_ok=True)
        Path("gl-security-reports/secret-scope.json").write_text(json.dumps(current, indent=2) + "\n")
        print(f"Verified secret scan scope: {len(current['commits'])} commits")
    else:
        raise ValueError("Unknown secret scope action")
