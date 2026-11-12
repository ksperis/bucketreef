# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from hashlib import sha256
from typing import Any

from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import (
    S3ExecutionContext,
    is_ceph_admin_execution_context,
)
from app.services.s3_client_options import resolve_s3_client_kwargs
from app.services.rgw_bucket_target import split_explicit_rgw_s3_bucket_name


DEFAULT_S3_EXECUTION_CREDENTIALS_ERROR = "S3 execution context is missing credentials"


class S3ExecutionCredentialsError(RuntimeError):
    """Expected failure when an execution target has no usable S3 credentials."""


def require_s3_execution_credentials(
    execution_context: S3ExecutionContext,
    *,
    error_message: str,
) -> tuple[str, str]:
    access_key, secret_key = execution_context.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise S3ExecutionCredentialsError(error_message)
    return access_key, secret_key


def require_s3_execution_credentials_with_error(
    execution_context: S3ExecutionContext,
    *,
    error_message: str,
    error_type: type[Exception],
) -> tuple[str, str]:
    try:
        return require_s3_execution_credentials(
            execution_context,
            error_message=error_message,
        )
    except S3ExecutionCredentialsError as exc:
        raise error_type(str(exc)) from exc


def s3_execution_client_kwargs(execution_context: S3ExecutionContext) -> dict[str, Any]:
    return {
        **resolve_s3_client_kwargs(execution_context),
        "session_token": execution_context.session_token(),
    }


def s3_execution_request_kwargs(
    execution_context: S3ExecutionContext,
    *,
    error_message: str = DEFAULT_S3_EXECUTION_CREDENTIALS_ERROR,
) -> dict[str, Any]:
    access_key, secret_key = require_s3_execution_credentials_with_error(
        execution_context,
        error_message=error_message,
        error_type=S3OperationError,
    )
    return {
        "access_key": access_key,
        "secret_key": secret_key,
        **s3_execution_client_kwargs(execution_context),
    }


def s3_execution_bucket_request_kwargs(
    execution_context: S3ExecutionContext,
    bucket_name: str,
    *,
    error_message: str = DEFAULT_S3_EXECUTION_CREDENTIALS_ERROR,
) -> dict[str, Any]:
    kwargs = s3_execution_request_kwargs(
        execution_context,
        error_message=error_message,
    )
    if not is_ceph_admin_execution_context(execution_context):
        return kwargs
    if split_explicit_rgw_s3_bucket_name(bucket_name) is None:
        return kwargs
    kwargs["force_path_style"] = True
    kwargs["allow_rgw_qualified_bucket_names"] = True
    return kwargs


def s3_execution_cache_key(execution_context: S3ExecutionContext) -> str:
    """Fingerprint the explicit execution identity and full S3 client configuration."""
    payload = json.dumps(
        [
            (execution_context.context_kind, execution_context.context_id),
            execution_context.execution_auth_session_id,
            execution_context.openstack_session_id,
            execution_context.rgw_tenant,
            execution_context.effective_rgw_credentials(),
            s3_execution_client_kwargs(execution_context),
        ],
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(payload.encode("utf-8")).hexdigest()
