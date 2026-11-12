# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from app.db import S3Connection
from app.services.iam_capability_probe import probe_iam_list_users
from app.services.rgw_iam import get_iam_client
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.s3_connection_capabilities import with_s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import resolve_connection_iam_options
from app.utils.storage_endpoint_features import resolve_iam_endpoint, resolve_iam_signing_region


def probe_connection_can_manage_iam(connection: S3Connection) -> bool:
    iam_endpoint, iam_region, verify_tls = resolve_connection_iam_options(connection)
    if not iam_endpoint or not connection.access_key_id or not connection.secret_access_key:
        return False
    return probe_iam_list_users(
        connection.access_key_id,
        connection.secret_access_key,
        endpoint=iam_endpoint,
        region=iam_region,
        verify_tls=verify_tls,
        client_factory=get_iam_client,
    )


def refresh_connection_detected_capabilities(connection: S3Connection) -> None:
    connection.capabilities = with_s3_connection_can_manage_iam(
        connection.capabilities,
        can_manage_iam=probe_connection_can_manage_iam(connection),
    )


def probe_execution_can_manage_iam(context: S3ExecutionContext) -> bool:
    """Use the same read-only IAM probe for a session-resolved S3 executor."""
    from app.services.s3_client_options import resolve_s3_client_options
    endpoint = context.storage_endpoint
    iam_endpoint = resolve_iam_endpoint(endpoint) if endpoint else None
    if not iam_endpoint or not context.access_key or not context.secret_key:
        return False
    _, _, _, verify_tls = resolve_s3_client_options(context)
    return probe_iam_list_users(
        context.access_key,
        context.secret_key,
        endpoint=iam_endpoint,
        region=resolve_iam_signing_region(endpoint),
        verify_tls=verify_tls,
        client_factory=get_iam_client,
    )
