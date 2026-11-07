# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.core.config import AppEnvironment, DeploymentProfile
from app.core.domain_enums import (
    ReadinessCheckLevel,
    ReadinessCheckResult,
    ReadinessCheckSeverity,
    ReadinessStatus,
)
from app.models.base import ApiModel


class ProductionReadinessFinding(ApiModel):
    code: str
    label: str
    result: ReadinessCheckResult
    severity: Optional[ReadinessCheckSeverity]
    level: ReadinessCheckLevel
    message: str
    documentation_url: str
    blocks_startup: bool


class ProductionReadinessResponse(ApiModel):
    environment: AppEnvironment
    profile: DeploymentProfile
    status: ReadinessStatus
    counts: dict[ReadinessCheckLevel, int]
    findings: list[ProductionReadinessFinding]
