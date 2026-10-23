# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import logging
from typing import Any, Generic, TypeVar

from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import User
from app.models.access_context import AccountAccess
from app.models.audit import AuditStatus
from app.routers.sse_worker import stream_status_operation
from app.services.audit_service import AuditService
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.portal.trash_restore import PortalDeletedPrefixRestoreTarget
from app.services.portal.version_cleanup import PortalStorageSpaceVersionCleanupTarget
from app.services.portal_service import PortalService

logger = logging.getLogger(__name__)
_ResultT = TypeVar("_ResultT", bound=BaseModel)


def _success_status(_result: BaseModel) -> AuditStatus:
    return "success"


@dataclass(frozen=True, slots=True)
class _PortalStreamAuditLifecycle(Generic[_ResultT]):
    actor: User
    access: AccountAccess
    audit_service: AuditService
    entity_id: str
    base_metadata: Mapping[str, Any]
    start_action: str
    result_action: str
    cancel_action: str
    error_action: str
    cancel_message: str
    result_metadata: Callable[[_ResultT], Mapping[str, Any]]
    result_status: Callable[[_ResultT], AuditStatus] = _success_status

    def _metadata(self, request_id: str, extra: Mapping[str, Any] | None = None) -> dict[str, Any]:
        return {
            **self.base_metadata,
            "request_id": request_id,
            **(extra or {}),
        }

    def on_start(self, request_id: str) -> None:
        self.audit_service.record_action(
            user=self.actor,
            scope="portal",
            action=self.start_action,
            entity_type="storage_space",
            entity_id=self.entity_id,
            account=self.access.account,
            metadata=self._metadata(request_id),
        )

    def on_result(self, request_id: str, result: _ResultT) -> None:
        self.audit_service.record_action(
            user=self.actor,
            scope="portal",
            action=self.result_action,
            entity_type="storage_space",
            entity_id=self.entity_id,
            account=self.access.account,
            metadata=self._metadata(request_id, self.result_metadata(result)),
            status=self.result_status(result),
        )

    def on_cancel(self, request_id: str) -> None:
        self.audit_service.record_action(
            user=self.actor,
            scope="portal",
            action=self.cancel_action,
            entity_type="storage_space",
            entity_id=self.entity_id,
            account=self.access.account,
            metadata=self._metadata(request_id),
            status="failure",
            message=self.cancel_message,
        )

    def on_error(self, request_id: str, detail: str) -> None:
        self.audit_service.record_action(
            user=self.actor,
            scope="portal",
            action=self.error_action,
            entity_type="storage_space",
            entity_id=self.entity_id,
            account=self.access.account,
            metadata=self._metadata(request_id),
            status="failure",
            message=detail,
        )


def stream_portal_storage_space_version_cleanup(
    request: Request,
    *,
    actor: User,
    access: AccountAccess,
    service: PortalService,
    audit_service: AuditService,
    target: PortalStorageSpaceVersionCleanupTarget,
) -> StreamingResponse:
    audit = _PortalStreamAuditLifecycle(
        actor=actor,
        access=access,
        audit_service=audit_service,
        entity_id=target.storage_space_id,
        base_metadata={
        "storage_space_id": target.storage_space_id,
        "storage_space_name": target.storage_space_name,
        "bucket_name": target.bucket_name,
        },
        start_action="start_storage_space_history_cleanup",
        result_action="finish_storage_space_history_cleanup",
        cancel_action="cancel_storage_space_history_cleanup",
        error_action="fail_storage_space_history_cleanup",
        cancel_message="Storage Space history cleanup canceled",
        result_metadata=lambda result: {
            "deleted_versions": result.deleted_versions,
            "deleted_delete_markers": result.deleted_delete_markers,
            "bytes_freed": result.bytes_freed,
        },
    )
    return stream_status_operation(
        request,
        run_operation=lambda progress_callback, cancel_check: service.run_storage_space_version_cleanup(
            target,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        cancelled_error=BucketPurgeCancelled,
        logger=logger,
        operation="portal_storage_space_history_cleanup",
        failure_message="Portal Storage Space history cleanup failed",
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
        unexpected_error_detail=sanitized_error_log_detail,
        expose_http_status=False,
    )


def stream_portal_deleted_prefix_restore(
    request: Request,
    *,
    actor: User,
    access: AccountAccess,
    service: PortalService,
    audit_service: AuditService,
    target: PortalDeletedPrefixRestoreTarget,
) -> StreamingResponse:
    audit = _PortalStreamAuditLifecycle(
        actor=actor,
        access=access,
        audit_service=audit_service,
        entity_id=target.storage_space_id,
        base_metadata={
        "storage_space_id": target.storage_space_id,
        "storage_space_name": target.storage_space_name,
        "bucket_name": target.bucket_name,
        "prefix": target.prefix,
        },
        start_action="start_restore_deleted_prefix",
        result_action="finish_restore_deleted_prefix",
        cancel_action="cancel_restore_deleted_prefix",
        error_action="fail_restore_deleted_prefix",
        cancel_message="Deleted prefix restoration canceled",
        result_metadata=lambda result: {
            "restore_candidates": result.restore_candidates,
            "restored_objects": result.restored_objects,
            "failed_objects": result.failed_objects,
        },
        result_status=lambda result: "success" if result.status == "completed" else "partial",
    )
    return stream_status_operation(
        request,
        run_operation=lambda progress_callback, cancel_check: service.run_deleted_prefix_restore(
            target,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        ),
        cancelled_error=BucketPurgeCancelled,
        logger=logger,
        operation="portal_deleted_prefix_restore",
        failure_message="Portal deleted prefix restoration failed",
        on_start=audit.on_start,
        on_result=audit.on_result,
        on_cancel=audit.on_cancel,
        on_error=audit.on_error,
        unexpected_error_detail=sanitized_error_log_detail,
        expose_http_status=False,
    )
