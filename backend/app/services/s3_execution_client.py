# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from hashlib import sha256
from typing import Any

from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.services.rgw_bucket_target import split_explicit_rgw_s3_bucket_name
from app.utils.s3_endpoint import resolve_s3_client_kwargs


def require_s3_execution_credentials(
    execution_context: S3ExecutionTarget,
    *,
    error_message: str,
) -> tuple[str, str]:
    access_key, secret_key = execution_context.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise RuntimeError(error_message)
    return access_key, secret_key


def s3_execution_client_kwargs(execution_context: S3ExecutionTarget) -> dict[str, Any]:
    return {
        **resolve_s3_client_kwargs(execution_context),
        "session_token": execution_context.session_token(),
    }


def s3_execution_request_kwargs(
    execution_context: S3ExecutionTarget,
    *,
    error_message: str,
) -> dict[str, Any]:
    access_key, secret_key = require_s3_execution_credentials(
        execution_context,
        error_message=error_message,
    )
    return {
        "access_key": access_key,
        "secret_key": secret_key,
        **s3_execution_client_kwargs(execution_context),
    }


def s3_execution_bucket_request_kwargs(
    execution_context: S3ExecutionTarget,
    bucket_name: str,
    *,
    error_message: str,
) -> dict[str, Any]:
    kwargs = s3_execution_request_kwargs(
        execution_context,
        error_message=error_message,
    )
    if getattr(execution_context, "context_kind", None) != "ceph_admin":
        return kwargs
    if split_explicit_rgw_s3_bucket_name(bucket_name) is None:
        return kwargs
    kwargs["force_path_style"] = True
    kwargs["allow_rgw_qualified_bucket_names"] = True
    return kwargs


def s3_execution_cache_key(execution_context: S3ExecutionTarget) -> str:
    """Fingerprint the explicit execution identity and full S3 client configuration."""
    identity = (
        (execution_context.context_kind, execution_context.context_id)
        if isinstance(execution_context, S3ExecutionContext)
        else ("account", str(execution_context.id))
    )
    payload = json.dumps(
        [identity, execution_context.rgw_tenant,
         execution_context.effective_rgw_credentials(), s3_execution_client_kwargs(execution_context)],
        sort_keys=True,
        separators=(",", ":"),
    )
    return sha256(payload.encode("utf-8")).hexdigest()
