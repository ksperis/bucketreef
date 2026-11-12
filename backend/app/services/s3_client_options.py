# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.db import S3Account
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.s3_connection_endpoint import resolve_connection_iam_options
from app.utils.storage_endpoint_features import (
    resolve_iam_endpoint,
    resolve_iam_signing_region,
)


S3ClientTarget = S3Account | S3ExecutionContext


def _execution_context(target: S3ClientTarget) -> S3ExecutionContext | None:
    if isinstance(target, S3ExecutionContext):
        return target
    if isinstance(target, S3Account):
        return None
    raise TypeError("S3 client target must be an S3Account or S3ExecutionContext")


def resolve_s3_endpoint(target: S3ClientTarget) -> Optional[str]:
    context = _execution_context(target)
    if context is not None and context.session_endpoint:
        return context.session_endpoint
    endpoint = target.storage_endpoint
    if endpoint is not None and endpoint.endpoint_url:
        return endpoint.endpoint_url
    return None


def resolve_s3_client_options(
    target: S3ClientTarget,
) -> tuple[Optional[str], Optional[str], bool, bool]:
    """Resolve S3 client options (endpoint, region, force_path_style, verify_tls)."""
    context = _execution_context(target)
    endpoint = resolve_s3_endpoint(target)
    endpoint_obj = target.storage_endpoint
    region = context.session_region if context is not None else None
    session_force_path_style = context.session_force_path_style if context is not None else None
    session_verify_tls = context.session_verify_tls if context is not None else None
    if region is None:
        region = endpoint_obj.region if endpoint_obj is not None else None
    if session_force_path_style is not None:
        force_path_style = session_force_path_style
    elif endpoint_obj is not None:
        force_path_style = endpoint_obj.force_path_style
    else:
        force_path_style = False
    if session_verify_tls is not None:
        verify_tls = session_verify_tls
    elif endpoint_obj is not None:
        verify_tls = endpoint_obj.verify_tls
    else:
        verify_tls = True
    return endpoint, region, force_path_style, verify_tls


def resolve_s3_client_kwargs(target: S3ClientTarget) -> dict[str, object]:
    endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(target)
    return {
        "endpoint": endpoint,
        "region": region,
        "force_path_style": force_path_style,
        "verify_tls": verify_tls,
    }


def resolve_iam_client_options(target: S3ClientTarget) -> tuple[Optional[str], Optional[str], bool]:
    """Resolve IAM client options for an account or explicit execution context."""
    context = _execution_context(target)
    endpoint_obj = target.storage_endpoint
    region = context.session_region if context is not None else None
    verify_tls = True
    if endpoint_obj is not None:
        endpoint = resolve_iam_endpoint(endpoint_obj)
        if endpoint_obj.provider == "aws":
            region = resolve_iam_signing_region(endpoint_obj)
        elif region is None:
            region = resolve_iam_signing_region(endpoint_obj)
        verify_tls = endpoint_obj.verify_tls
        return endpoint, region, verify_tls

    if context is not None and context.source_connection is not None:
        return resolve_connection_iam_options(context.source_connection)

    endpoint, region, _, verify_tls = resolve_s3_client_options(target)
    return endpoint, region, verify_tls
