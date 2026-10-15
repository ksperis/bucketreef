# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3Account, S3User
from app.services.s3_execution_context import S3ExecutionContext


def resolve_target_tenant(target: S3Account | S3User | S3ExecutionContext) -> str:
    """Return the canonical RGW tenant, using an empty string for the default tenant."""
    return target.rgw_tenant or ""
