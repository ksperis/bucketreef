# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Check the current backend environment against BucketReef production hardening rules."""
from __future__ import annotations

import argparse
import json
from typing import Sequence

from pydantic import ValidationError

from app.core.config import DeploymentProfile, Settings
from app.core.database import SessionLocal
from app.models.app_settings import AppSettings
from app.services.app_settings_service import load_app_settings, load_app_settings_for_db_readonly
from app.services.deployment_checks import (
    DeploymentCheckFinding,
    deployment_exit_code,
    run_deployment_checks,
)


def _validation_messages(exc: ValidationError) -> list[str]:
    messages: list[str] = []
    for error in exc.errors(include_input=False, include_url=False):
        location = ".".join(str(part) for part in error.get("loc", ())) or "settings"
        messages.append(f"{location}: {error.get('msg', 'invalid value')}")
    return messages


def _render_text(findings: list[DeploymentCheckFinding]) -> str:
    return "\n".join(
        f"{finding.level.upper():8} {finding.code}: {finding.message} [{finding.documentation_url}]"
        for finding in findings
    )


def _render_json(findings: list[DeploymentCheckFinding]) -> str:
    return json.dumps(
        [
            {
                "code": finding.code,
                "label": finding.label,
                "result": finding.result,
                "severity": finding.severity,
                "level": finding.level,
                "message": finding.message,
                "documentation_url": finding.documentation_url,
                "blocks_startup": finding.blocks_startup,
            }
            for finding in findings
        ],
        indent=2,
        sort_keys=True,
    )


def run(
    *,
    profile: DeploymentProfile | None = None,
    json_output: bool = False,
    settings: Settings | None = None,
    app_settings: AppSettings | None = None,
) -> tuple[int, str]:
    try:
        runtime = settings or Settings()
    except ValidationError as exc:
        findings = [
            DeploymentCheckFinding(
                code="settings",
                label="Runtime configuration",
                result="fail",
                severity="blocker",
                message=message,
                documentation_url="https://docs.bucketreef.ksperis.com/ops/configuration/",
                blocks_startup=True,
            )
            for message in _validation_messages(exc)
        ]
        return 1, _render_json(findings) if json_output else _render_text(findings)

    selected_profile = profile or runtime.deployment_profile
    if settings is None:
        with SessionLocal() as db:
            try:
                effective_app_settings = app_settings or load_app_settings_for_db_readonly(db)
            except Exception:
                effective_app_settings = None
            findings = run_deployment_checks(
                runtime,
                app_settings=effective_app_settings,
                profile=selected_profile,
                db=db,
            )
    else:
        try:
            effective_app_settings = app_settings or load_app_settings()
        except Exception:
            effective_app_settings = None
        findings = run_deployment_checks(
            runtime,
            app_settings=effective_app_settings,
            profile=selected_profile,
        )
    output = _render_json(findings) if json_output else _render_text(findings)
    return deployment_exit_code(findings), output


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profile",
        choices=("full", "admin", "admin-no-ceph-admin", "user", "ceph-admin-high-security"),
        default=None,
        help="Override DEPLOYMENT_PROFILE for this check.",
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
