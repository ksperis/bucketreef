# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


CheckResult = Literal["pass", "fail", "manual"]
CheckSeverity = Literal["blocker", "critical", "warning"]
CheckLevel = Literal["blocked", "critical", "warning", "manual", "ok"]
CheckPhase = Literal["pre-database", "full"]
ReadinessStatus = Literal["blocked", "critical", "warning", "ok"]

DOCS_BASE_URL = "https://docs.bucketreef.ksperis.com/admin/en/operations/production-checks/"


@dataclass(frozen=True)
class DeploymentCheckFinding:
    code: str
    label: str
    result: CheckResult
    severity: CheckSeverity | None
    message: str
    documentation_url: str
    blocks_startup: bool = False

    @property
    def level(self) -> CheckLevel:
        if self.result == "manual":
            return "manual"
        if self.result == "pass":
            return "ok"
        if self.severity == "blocker":
            return "blocked"
        if self.severity == "critical":
            return "critical"
        return "warning"


def documentation_url(anchor: str) -> str:
    return f"{DOCS_BASE_URL}#{anchor}"


def finding(
    code: str,
    label: str,
    *,
    passed: bool,
    severity: CheckSeverity,
    pass_message: str,
    fail_message: str,
    docs_anchor: str | None = None,
    blocks_startup: bool = False,
) -> DeploymentCheckFinding:
    return DeploymentCheckFinding(
        code=code,
        label=label,
        result="pass" if passed else "fail",
        severity=severity,
        message=pass_message if passed else fail_message,
        documentation_url=documentation_url(docs_anchor or code),
        blocks_startup=bool(not passed and blocks_startup),
    )


def manual_finding(
    code: str,
    label: str,
    message: str,
    docs_anchor: str | None = None,
) -> DeploymentCheckFinding:
    return DeploymentCheckFinding(
        code=code,
        label=label,
        result="manual",
        severity=None,
        message=message,
        documentation_url=documentation_url(docs_anchor or code),
    )
