# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

from sqlalchemy.orm import Session

from app.models.operation import OperationSkippedResponse
from app.services.operation_lease_service import OperationLeaseService


_ResultT = TypeVar("_ResultT")


def run_internal_leased_operation(
    db: Session,
    operation_name: str,
    *,
    ttl_seconds: int,
    work: Callable[[], _ResultT],
    lease_context: dict[str, Any] | None = None,
) -> _ResultT | OperationSkippedResponse:
    effective_lease_context = (
        {"source": "internal"} if lease_context is None else lease_context
    )
    with OperationLeaseService(db).hold(
        operation_name,
        ttl_seconds=ttl_seconds,
        lease_context=effective_lease_context,
    ) as lease:
        if lease is None:
            return OperationSkippedResponse(
                status="skipped",
                reason="already_running",
                operation=operation_name,
            )
        return work()
