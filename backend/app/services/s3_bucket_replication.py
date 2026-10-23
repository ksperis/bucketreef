# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional, Unpack

from botocore.exceptions import BotoCoreError, ClientError, ParamValidationError

from app.services.s3_bucket_config_delete import delete_bucket_configuration
from app.services.s3_client import S3BucketClientKwargs, get_s3_bucket_client
from app.utils.aws_errors import aws_error_code

logger = logging.getLogger(__name__)


def get_bucket_replication(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> dict:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        resp = client.get_bucket_replication(Bucket=bucket_name)
    except ClientError as exc:
        code = aws_error_code(exc, lowercase=True)
        if code in {"replicationconfigurationnotfounderror", "nosuchreplicationconfiguration", "nosuchbucket"}:
            return {}
        raise RuntimeError(f"Unable to fetch bucket replication for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket replication for '{bucket_name}': {exc}") from exc
    config = resp.get("ReplicationConfiguration") or {}
    return config if isinstance(config, dict) else {}


def put_bucket_replication(
    bucket_name: str,
    configuration: dict,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        client.put_bucket_replication(
            Bucket=bucket_name,
            ReplicationConfiguration=configuration,
        )
    except ParamValidationError as exc:
        raise ValueError(f"Invalid bucket replication configuration: {exc}") from exc
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket replication for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket replication for %s", bucket_name)


def delete_bucket_replication(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    deleted = delete_bucket_configuration(
        operation=lambda: client.delete_bucket_replication(Bucket=bucket_name),
        missing_error_codes={"replicationconfigurationnotfounderror", "nosuchreplicationconfiguration", "nosuchbucket"},
        error_message=f"Unable to delete bucket replication for '{bucket_name}'",
    )
    if deleted:
        logger.debug("Deleted bucket replication for %s", bucket_name)
