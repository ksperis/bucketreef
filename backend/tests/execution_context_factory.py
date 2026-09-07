# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.models.execution_context import ExecutionContext, ExecutionContextCapabilities
from app.models.account_capabilities import AccountCapabilities
from app.services.s3_execution_context import S3ExecutionContext


def make_execution_context(**overrides: Any) -> ExecutionContext:
    values: dict[str, Any] = {
        "kind": "account",
        "id": "1",
        "display_name": "Execution context",
        "endpoint_name": "Storage endpoint",
        "endpoint_is_default": False,
        "endpoint_url": "https://s3.example.test",
        "storage_endpoint_capabilities": {},
        "capabilities": ExecutionContextCapabilities(
            can_manage_iam=False,
            sts_capable=False,
            admin_api_capable=False,
        ),
    }
    values.update(overrides)
    return ExecutionContext(**values)


def make_s3_execution_context(
    *, can_manage_buckets: bool = False, can_manage_iam: bool = False, **overrides: Any,
) -> S3ExecutionContext:
    """Build the runtime contract with no implicit Manager capabilities."""
    values: dict[str, Any] = {
        "context_id": "1",
        "context_kind": "account",
        "id": 1,
        "name": "Execution context",
        "access_key": "TEST-AK",
        "secret_key": "TEST-SK",
        "manager_capabilities": AccountCapabilities(
            can_manage_buckets=can_manage_buckets, can_manage_iam=can_manage_iam,
        ),
    }
    values.update(overrides)
    return S3ExecutionContext(**values)
