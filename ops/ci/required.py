#!/usr/bin/env python3
"""The required GitHub check must also fail when selection or a dependency fails."""
import json
import os

from plan import PUBLIC, require_results


def check(needs: dict) -> None:
    if needs.get("plan", {}).get("result") != "success":
        raise ValueError("CI selection did not succeed")
    expected = json.loads(needs["plan"]["outputs"]["jobs"])
    if not isinstance(expected, list) or not expected or set(expected) - set(PUBLIC):
        raise ValueError("Invalid expected validation set")
    if not {"ci-contract", "project-naming", "secret-scan"} <= set(expected):
        raise ValueError("Mandatory policy validations missing")
    require_results(expected, {name: value.get("result") for name, value in needs.items()})


if __name__ == "__main__":
    check(json.loads(os.environ["CI_NEEDS_JSON"]))
