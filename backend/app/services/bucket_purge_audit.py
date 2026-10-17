# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from app.core.database import SessionLocal
from app.db import User
from app.models.bucket_purge import BucketPurgeResult
from app.services.audit_service import AuditService
from app.services.s3_execution_context import S3ExecutionContext


def record_bucket_purge_audit(
    *,
    user_id: int,
    user_email: str,
    user_role: str,
    scope: str,
    request_id: str,
    action: str,
    entity_type: str = "bucket_purge",
    entity_id: str | None = None,
    execution_context: S3ExecutionContext | None = None,
    status: str = "success",
    message: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db = SessionLocal()
    try:
        AuditService(db).record_action(
            user=db.get(User, user_id),
            user_email=user_email,
            user_role=user_role,
            scope=scope,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id or request_id,
            execution_context=execution_context,
            status=status,
            message=message,
            metadata=metadata,
            request_id=request_id,
        )
    finally:
        db.close()


def _result_completed(result: BucketPurgeResult) -> bool:
    return result.status == "completed"


def _standard_result_metadata(result: BucketPurgeResult) -> dict[str, Any]:
    return {
        "result_status": result.status,
        "deleted_objects": result.deleted_objects,
        "deleted_versions": result.deleted_versions,
        "failed_count": result.failed_count,
    }


@dataclass(frozen=True, slots=True)
class BucketPurgeAuditLifecycle:
    record: Callable[..., None]
    base_metadata: Mapping[str, Any]
    start_action: str = "start_bucket_purge"
    result_action: str = "finish_bucket_purge"
    cancel_action: str = "cancel_bucket_purge"
    error_action: str = "fail_bucket_purge"
    cancel_message: str = "Bucket purge canceled"
    result_failure_action: str | None = None
    result_succeeded: Callable[[BucketPurgeResult], bool] = _result_completed
    result_metadata: Callable[[BucketPurgeResult], dict[str, Any]] = _standard_result_metadata
    after_result: Callable[[BucketPurgeResult], None] | None = None

    def on_start(self, request_id: str) -> None:
        self.record(
            request_id=request_id,
            action=self.start_action,
            metadata=dict(self.base_metadata),
        )

    def on_result(self, request_id: str, result: BucketPurgeResult) -> None:
        if self.after_result:
            self.after_result(result)
        succeeded = self.result_succeeded(result)
        action = self.result_action if succeeded or self.result_failure_action is None else self.result_failure_action
        self.record(
            request_id=request_id,
            action=action,
            status="success" if succeeded else "failure",
            metadata={**self.base_metadata, **self.result_metadata(result)},
        )

    def on_cancel(self, request_id: str) -> None:
        self.record(
            request_id=request_id,
            action=self.cancel_action,
            status="failure",
            message=self.cancel_message,
            metadata=dict(self.base_metadata),
        )

    def on_error(self, request_id: str, detail: str) -> None:
        self.record(
            request_id=request_id,
            action=self.error_action,
            status="failure",
            message=detail,
            metadata=dict(self.base_metadata),
        )
