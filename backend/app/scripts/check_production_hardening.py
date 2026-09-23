# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Check the current backend environment against BucketReef production hardening rules."""
from __future__ import annotations

import argparse
import json
from typing import Sequence

from pydantic import ValidationError

from app.core.config import Settings
from app.services.production_hardening import (
    DeploymentProfile,
    HardeningFinding,
    check_production_hardening,
    hardening_exit_code,
)


def _validation_messages(exc: ValidationError) -> list[str]:
    messages: list[str] = []
    for error in exc.errors(include_input=False, include_url=False):
        location = ".".join(str(part) for part in error.get("loc", ())) or "settings"
        messages.append(f"{location}: {error.get('msg', 'invalid value')}")
    return messages


def _render_text(findings: list[HardeningFinding]) -> str:
    return "\n".join(f"{finding.level.upper():7} {finding.code}: {finding.message}" for finding in findings)


def _render_json(findings: list[HardeningFinding]) -> str:
    return json.dumps(
        [
            {"code": finding.code, "level": finding.level, "message": finding.message}
            for finding in findings
        ],
        indent=2,
        sort_keys=True,
    )


def run(
    *,
    profile: DeploymentProfile,
    json_output: bool = False,
    settings: Settings | None = None,
) -> tuple[int, str]:
    try:
        runtime = settings or Settings()
    except ValidationError as exc:
        findings = [
            HardeningFinding("settings", "fail", message)
            for message in _validation_messages(exc)
        ]
        return 1, _render_json(findings) if json_output else _render_text(findings)

    findings = check_production_hardening(runtime, profile=profile)
    output = _render_json(findings) if json_output else _render_text(findings)
    return hardening_exit_code(findings), output


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profile",
        choices=("full", "admin", "user", "ceph-admin-high-security"),
        default="full",
    )
    parser.add_argument("--json", action="store_true", dest="json_output")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    exit_code, output = run(profile=args.profile, json_output=args.json_output)
    print(output)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
