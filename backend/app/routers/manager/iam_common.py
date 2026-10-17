# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.domain_errors import (
    ManagerIAMCredentialsMissingError,
    ManagerIAMManagedUserConflictError,
)
from app.models.policy import InlinePolicy
from app.services.manager_iam_support import (
    build_iam_service_for_context,
    ensure_unmanaged_iam_user as ensure_unmanaged_iam_user_service,
    validate_inline_policy_name,
)
from app.services.rgw_iam import RGWIAMService
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_request_from_value_error, raise_http_error_from_value_error


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
    try:
        validate_inline_policy_name(payload, policy_name)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
