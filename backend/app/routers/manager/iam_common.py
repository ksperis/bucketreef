# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.domain_errors import (
    ManagerIAMCredentialsMissingError,
    ManagerIAMManagedUserConflictError,
)
from app.services.access_context_contracts import ManagerActor
from app.models.policy import InlinePolicy
from app.services.audit_service import AuditService
from app.services.manager_iam_support import (
    build_iam_service_for_context,
    ensure_unmanaged_iam_user as ensure_unmanaged_iam_user_service,
)
from app.services.rgw_iam import RGWIAMError, RGWIAMService
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import (
    raise_bad_gateway_from_runtime,
    raise_bad_request_from_value_error,
    raise_http_error_from_value_error,
    raise_http_exception_from_exception,
)

_T = TypeVar("_T")


def ensure_unmanaged_iam_user(db: Session, context: S3ExecutionContext, user_name: str) -> None:
    try:
        ensure_unmanaged_iam_user_service(db, context, user_name)
    except ManagerIAMManagedUserConflictError as exc:
        raise_http_error_from_value_error(exc)


def get_iam_service_for_context(context: S3ExecutionContext) -> RGWIAMService:
    try:
        return build_iam_service_for_context(context)
    except ManagerIAMCredentialsMissingError as exc:
        raise_bad_request_from_value_error(exc)


def ensure_inline_policy_name(payload: InlinePolicy, policy_name: str) -> None:
    if payload.name and payload.name != policy_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inline policy name in payload does not match the URL.",
        )


def run_iam_read(read: Callable[[], _T]) -> _T:
    try:
        return read()
    except RGWIAMError as exc:
        raise_bad_gateway_from_runtime(exc)


def run_audited_iam_mutation(
    *,
    mutation: Callable[[], _T],
    audit_service: AuditService,
    current_user: ManagerActor,
    context: S3ExecutionContext,
    action: str,
    entity_type: str,
    entity_id: str,
    metadata: dict[str, object],
) -> _T:
    try:
        result = mutation()
        audit_service.record_action(
            user=current_user,
            scope="manager",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            execution_context=context,
            metadata=metadata,
        )
        return result
    except RGWIAMError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
