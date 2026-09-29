#!/usr/bin/env python3
"""Installation identity and allowlisted diagnostics; never archive container env/logs."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def command(*args, env=None, timeout=600):
    return subprocess.check_output(args, env=env, stderr=subprocess.DEVNULL, timeout=timeout).decode().strip()


def inspect_image(ref):
    image = json.loads(command("docker", "image", "inspect", ref))[0]
    return {"id": image["Id"], "arch": image["Architecture"], "os": image["Os"]}


def preload(*, kind=False):
    inventory = read("candidate-inventory.json")
    for name, expected in inventory["artifact"]["files"].items():
        if Path(name).name != name or hashlib.sha256((Path("public-candidate") / name).read_bytes()).hexdigest() != expected:
            raise ValueError("Installation input differs from the anonymous candidate")
    arch = "amd64" if kind else os.environ["IMAGE_ARCH"]
    images = {}
    with tempfile.TemporaryDirectory() as temporary:
        Path(temporary, "config.json").write_text('{"auths":{}}')
        env = {**os.environ, "DOCKER_CONFIG": temporary}
        for component in (("backend", "frontend") if kind else inventory["images"]):
            manifest = inventory["images"][component]["platforms"][arch]
            repository = f"ghcr.io/ksperis/bucketreef-{component}"
            ref = f"{repository}@{manifest}"
            # Also pull Kind inputs by their expected platform digest, regardless
            # of previously loaded tags or orchestration environment overrides.
            command("docker", "pull", "--platform", f"linux/{arch}", ref, env=env)
            command("docker", "tag", ref, f"{repository}:{inventory['version']}")
            image = inspect_image(f"{repository}:{inventory['version']}")
            if image["arch"] != arch or image["os"] != "linux":
                raise ValueError("Installed candidate image architecture differs")
            images[component] = {**image, "manifest": manifest}
    write(f"installation-images/{'kind' if kind else arch}.json", images)


def verify_compose(project, phase):
    expected = read("/tmp/expected-images.json")
    ids = command("docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project}").split()
    containers = json.loads(command("docker", "inspect", *ids)) if ids else []
    actual = {}
    for container in containers:
        component = container["Config"]["Labels"]["com.docker.compose.service"]
        if component not in expected:
            raise ValueError("Unexpected running Compose service")
        image = inspect_image(container["Image"])
        if image != {k: expected[component][k] for k in ("id", "arch", "os")} or not container["State"]["Running"]:
            raise ValueError("Running Compose image differs from the downloaded candidate")
        actual[component] = expected[component]
    if set(actual) != set(expected) or len(containers) != len(expected):
        raise ValueError("Missing or duplicate installed candidate component")
    path = Path("/tmp/installation-checkpoints.json")
    checkpoints = read(path) if path.exists() else {}
    checkpoints[phase] = actual
    write(path, checkpoints)


def verify_kind():
    expected = read("installation-images/kind.json")
    pods = json.loads(command("kubectl", "-n", "bucketreef-smoke", "get", "pods", "-o", "json"))["items"]
    actual = {}
    for pod in pods:
        component = pod["metadata"].get("labels", {}).get("app.kubernetes.io/component")
        if component not in expected:
            continue
        for container in pod["status"].get("containerStatuses", []):
            image_id = container.get("imageID", "")
            digest = re.search(r"sha256:[0-9a-f]{64}$", image_id)
            if not container.get("ready") or not digest or digest[0] not in {expected[component]["manifest"], expected[component]["id"]}:
                raise ValueError("Running Kind image differs from the candidate")
            actual[component] = expected[component]
    if set(actual) != set(expected):
        raise ValueError("Missing installed Kind component")
    nodes = json.loads(command("kubectl", "get", "nodes", "-o", "json"))["items"]
    if not nodes or any(n["status"]["nodeInfo"]["architecture"] != "amd64" for n in nodes):
        raise ValueError("Kind node architecture differs from its tested images")
    write("smoke-diagnostics/kind/checkpoints.json", {"install-and-upgrade": actual})
    complete("kind")


def complete(key):
    inventory = read("candidate-inventory.json")
    candidate_hash = hashlib.sha256(json.dumps(inventory, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    checkpoints = read(f"smoke-diagnostics/{key}/checkpoints.json")
    write(f"installation-receipts/{key}.json", {
        "schema": 1, "status": "success", "sha": inventory["sha"], "version": inventory["version"],
        "pipeline_id": int(os.environ["CI_PIPELINE_ID"]), "job_id": int(os.environ["CI_JOB_ID"]),
        "candidate_sha256": candidate_hash, "checkpoints": checkpoints,
    })


def safe_container(container):
    """Positive field selection excludes env, commands, health output and secrets."""
    state = container["State"]
    return {"id": container["Id"], "image_id": container["Image"],
            "name": container["Name"], "state": {key: state.get(key) for key in
                ("Status", "Running", "ExitCode", "OOMKilled", "StartedAt", "FinishedAt")},
            "health": {"status": state.get("Health", {}).get("Status"),
                       "checks": [{k: entry.get(k) for k in ("Start", "End", "ExitCode")}
                                  for entry in state.get("Health", {}).get("Log", [])]}}


def diagnostics(key):
    result = {"schema": 1, "captured_at": int(time.time()), "containers": []}
    try:
        ids = command("docker", "ps", "-aq", timeout=10).split()
        for cid in ids:
            container = json.loads(command("docker", "inspect", cid, timeout=10))[0]
            result["containers"].append(safe_container(container))
        result["images"] = read(f"installation-images/{key}.json")
        if key == "kind":
            pods = json.loads(command("kubectl", "-n", "bucketreef-smoke", "get", "pods", "-o", "json", timeout=10))["items"]
            result["pods"] = [{"name": pod["metadata"]["name"], "phase": pod["status"].get("phase"),
                               "containers": [{k: c.get(k) for k in ("name", "ready", "restartCount", "imageID")}
                                              for c in pod["status"].get("containerStatuses", [])]} for pod in pods]
    except (OSError, ValueError, subprocess.SubprocessError):
        result["collection_incomplete"] = True
    write(f"smoke-diagnostics/{key}/containers.json", result)


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "preload": preload()
    elif action == "kind-preload": preload(kind=True)
    elif action == "verify-compose": verify_compose(*sys.argv[2:])
    elif action == "verify-kind": verify_kind()
    elif action == "complete": complete(sys.argv[2])
    elif action == "diagnostics": diagnostics(sys.argv[2])
    else: raise ValueError("Unknown installation evidence action")
