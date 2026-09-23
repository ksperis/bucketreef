# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from app.core.config import DeploymentProfile
from app.models.base import ApiModel


HardeningLevel = Literal["pass", "warning", "fail"]


class ProductionReadinessFinding(ApiModel):
    code: str
    label: str
    level: HardeningLevel
    message: str


class ProductionReadinessResponse(ApiModel):
    profile: DeploymentProfile
    status: HardeningLevel
    counts: dict[HardeningLevel, int]
    findings: list[ProductionReadinessFinding]
