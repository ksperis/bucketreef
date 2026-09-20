#!/usr/bin/env python3
"""One lock for image digests and explicit CLI versions used by both adapters."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TOOLS = json.loads((ROOT / "ops/ci/tools.json").read_text())


def pin(value):
    if isinstance(value, dict): return {key: pin(item) for key, item in value.items()}
    if isinstance(value, list): return [pin(item) for item in value]
    return TOOLS["images"].get(value, value) if isinstance(value, str) else value


def check_node():
    if subprocess.check_output(["node", "--version"], text=True).strip() != "v" + TOOLS["node"]:
        raise ValueError("Node runtime differs from the CI lock")
    package = json.loads((ROOT / "frontend/node_modules/@playwright/test/package.json").read_text())
    if package["version"] != TOOLS["playwright"]:
        raise ValueError("Playwright package differs from its browser image")


if __name__ == "__main__":
    if sys.argv[1] == "check-node": check_node()
    elif sys.argv[1] == "image": print(TOOLS["images"][sys.argv[2]])
    else: print(TOOLS[sys.argv[1]])
