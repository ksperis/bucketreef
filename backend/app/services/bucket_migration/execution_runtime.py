# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.s3_execution_context import S3ExecutionTarget


MIGRATION_USER_AGENT_MARKER = "bucketreef-migration-worker"


@dataclass
class ResolvedContext:
    context_id: str
    execution_context: S3ExecutionTarget
    endpoint: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool


@dataclass(frozen=True)
class MigrationRuntimeLimits:
    parallelism_default: int
    parallelism_max: int
    max_active_per_endpoint: int
