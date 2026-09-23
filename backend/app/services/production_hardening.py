# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Backward-compatible facade over the unified deployment-check engine."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.core.config import DeploymentProfile, Settings
from app.models.app_settings import AppSettings
from app.services.deployment_checks import DeploymentCheckFinding, run_deployment_checks


HardeningLevel = Literal["pass", "warning", "fail"]


@dataclass(frozen=True)
class HardeningFinding:
    code: str
    level: HardeningLevel
    message: str


_LEGACY_LABELS: dict[str, str] = {
    "app-env": "Production environment",
    "app-settings": "Application settings",
    "admin-passkey-policy": "Administrator passkey policy",
    "trusted-origins": "Trusted browser origins",
    "database": "Database",
    "job-owner": "Scheduled job ownership",
    "cron-token": "Scheduler token",
    "high-security-mode": "Ceph Admin high-security mode",
    "shared-origins": "Trusted public origins",
    "webauthn-origins": "WebAuthn origins",
}


def hardening_finding_label(code: str) -> str:
    if code.startswith("surface-"):
        surface = code.removeprefix("surface-").replace("-", " ")
        return f"Runtime surface: {surface.title()}"
    return _LEGACY_LABELS.get(code, code.replace("-", " ").title())


def _legacy_level(finding: DeploymentCheckFinding) -> HardeningLevel:
    if finding.level == "ok":
        return "pass"
    if finding.level == "warning":
        return "warning"
    return "fail"


def check_production_hardening(
    settings: Settings,
    *,
    app_settings: AppSettings | None,
    profile: DeploymentProfile | None = None,
) -> list[HardeningFinding]:
    findings = run_deployment_checks(
        settings,
        app_settings=app_settings,
        profile=profile,
        include_manual=False,
    )
    return [
        HardeningFinding(code=finding.code, level=_legacy_level(finding), message=finding.message)
        for finding in findings
    ]


def hardening_status(findings: list[HardeningFinding]) -> HardeningLevel:
    if any(finding.level == "fail" for finding in findings):
        return "fail"
    if any(finding.level == "warning" for finding in findings):
        return "warning"
    return "pass"


def hardening_counts(findings: list[HardeningFinding]) -> dict[HardeningLevel, int]:
    counts: dict[HardeningLevel, int] = {"pass": 0, "warning": 0, "fail": 0}
    for finding in findings:
        counts[finding.level] += 1
    return counts


def hardening_exit_code(findings: list[HardeningFinding]) -> int:
    return 1 if any(finding.level == "fail" for finding in findings) else 0
