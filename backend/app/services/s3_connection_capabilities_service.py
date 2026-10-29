# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from botocore.exceptions import BotoCoreError, ClientError

from app.db import S3Connection
from app.services.rgw_iam import get_iam_client
from app.utils.s3_connection_capabilities import dump_s3_connection_capabilities
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.storage_endpoint_features import (
    aws_iam_client_options_for_region,
    resolve_iam_endpoint,
    resolve_iam_signing_region,
)


def probe_connection_can_manage_iam(connection: S3Connection) -> bool:
    details = resolve_connection_details(connection)
    endpoint_obj = connection.storage_endpoint
    if endpoint_obj is not None:
        iam_endpoint = resolve_iam_endpoint(endpoint_obj)
        if iam_endpoint is None:
            return False
        iam_region = resolve_iam_signing_region(endpoint_obj)
    elif (details.provider or "").strip().lower() == "aws":
        iam_endpoint, iam_region = aws_iam_client_options_for_region(details.region)
    else:
        iam_endpoint = details.endpoint_url
        iam_region = details.region
    if not iam_endpoint or not connection.access_key_id or not connection.secret_access_key:
        return False
    try:
        client = get_iam_client(
            access_key=connection.access_key_id,
            secret_key=connection.secret_access_key,
            endpoint=iam_endpoint,
            region=iam_region,
            verify_tls=details.verify_tls,
        )
        client.list_users(MaxItems=1)
        return True
    except (ClientError, BotoCoreError, RuntimeError):
        return False


def refresh_connection_detected_capabilities(connection: S3Connection) -> None:
    connection.capabilities_json = dump_s3_connection_capabilities(
        connection.capabilities_json,
        can_manage_iam=probe_connection_can_manage_iam(connection),
    )


def probe_execution_can_manage_iam(context) -> bool:
    """Use the same read-only IAM probe for a session-resolved S3 executor."""
    from app.utils.s3_endpoint import resolve_s3_client_options
    endpoint = context.storage_endpoint
    iam_endpoint = resolve_iam_endpoint(endpoint) if endpoint else None
    if not iam_endpoint or not context.access_key or not context.secret_key:
        return False
    _, _, _, verify_tls = resolve_s3_client_options(context)
    try:
        get_iam_client(access_key=context.access_key, secret_key=context.secret_key,
                       endpoint=iam_endpoint, region=resolve_iam_signing_region(endpoint),
                       verify_tls=verify_tls).list_users(MaxItems=1)
        return True
    except (ClientError, BotoCoreError, RuntimeError):
        return False
