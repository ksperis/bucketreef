# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from app.core.config import AppEnvironment, DeploymentProfile
from app.models.base import ApiModel


CheckResult = Literal["pass", "fail", "manual"]
CheckSeverity = Literal["blocker", "critical", "warning"]
CheckLevel = Literal["blocked", "critical", "warning", "manual", "ok"]
ReadinessStatus = Literal["blocked", "critical", "warning", "ok"]


class ProductionReadinessFinding(ApiModel):
    code: str
    label: str
    result: CheckResult
    severity: Optional[CheckSeverity] = None
    level: CheckLevel
    message: str
    documentation_url: str
    blocks_startup: bool = False


class ProductionReadinessResponse(ApiModel):
    environment: AppEnvironment
    profile: DeploymentProfile
    status: ReadinessStatus
    counts: dict[CheckLevel, int]
    findings: list[ProductionReadinessFinding]
