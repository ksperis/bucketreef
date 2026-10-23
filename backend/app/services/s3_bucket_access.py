# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from typing import Optional, Unpack

from botocore.exceptions import BotoCoreError, ClientError

from app.services.s3_bucket_config_delete import delete_bucket_configuration
from app.services.s3_client import S3BucketClientKwargs, get_s3_bucket_client
from app.utils.aws_errors import aws_error_code

logger = logging.getLogger(__name__)


def get_bucket_cors(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> list[dict]:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        resp = client.get_bucket_cors(Bucket=bucket_name)
        return resp.get("CORSRules", []) or []
    except ClientError as exc:
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchcorsconfiguration", "nosuchbucket"}:
            return []
        raise RuntimeError(f"Unable to fetch bucket CORS for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket CORS for '{bucket_name}': {exc}") from exc


def put_bucket_cors(
    bucket_name: str,
    rules: list[dict],
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        client.put_bucket_cors(Bucket=bucket_name, CORSConfiguration={"CORSRules": rules})
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket CORS for '{bucket_name}': {exc}") from exc
    logger.debug("Updated CORS for bucket %s", bucket_name)


def delete_bucket_cors(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    deleted = delete_bucket_configuration(
        operation=lambda: client.delete_bucket_cors(Bucket=bucket_name),
        missing_error_codes={"nosuchcorsconfiguration", "nosuchbucket"},
        error_message=f"Unable to delete bucket CORS for '{bucket_name}'",
    )
    if deleted:
        logger.debug("Deleted CORS for bucket %s", bucket_name)


def get_bucket_website(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> Optional[dict]:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        resp = client.get_bucket_website(Bucket=bucket_name)
    except ClientError as exc:
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchwebsiteconfiguration", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch bucket website for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket website for '{bucket_name}': {exc}") from exc
    config: dict = {}
    for key in ("IndexDocument", "ErrorDocument", "RedirectAllRequestsTo", "RoutingRules"):
        if resp.get(key) is not None:
            config[key] = resp.get(key)
    return config or None


def put_bucket_website(
    bucket_name: str,
    configuration: dict,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        client.put_bucket_website(Bucket=bucket_name, WebsiteConfiguration=configuration)
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket website for '{bucket_name}': {exc}") from exc
    logger.debug("Updated bucket website for bucket %s", bucket_name)


def delete_bucket_website(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    deleted = delete_bucket_configuration(
        operation=lambda: client.delete_bucket_website(Bucket=bucket_name),
        missing_error_codes={"nosuchwebsiteconfiguration", "nosuchbucket"},
        error_message=f"Unable to delete bucket website for '{bucket_name}'",
    )
    if deleted:
        logger.debug("Deleted bucket website for bucket %s", bucket_name)


def get_bucket_policy(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> Optional[dict]:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        resp = client.get_bucket_policy(Bucket=bucket_name)
    except ClientError as exc:
        code = aws_error_code(exc, lowercase=True)
        if code in {"nosuchbucketpolicy", "nosuchbucket"}:
            return None
        raise RuntimeError(f"Unable to fetch bucket policy for '{bucket_name}': {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"Unable to fetch bucket policy for '{bucket_name}': {exc}") from exc
    policy_str = resp.get("Policy")
    if not policy_str:
        return None
    try:
        return json.loads(policy_str)
    except json.JSONDecodeError:
        return {"raw": policy_str}


def put_bucket_policy(
    bucket_name: str,
    policy: dict,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    try:
        client.put_bucket_policy(Bucket=bucket_name, Policy=json.dumps(policy))
    except (BotoCoreError, ClientError) as exc:
        raise RuntimeError(f"Unable to set bucket policy for '{bucket_name}': {exc}") from exc
    logger.debug("Updated policy for bucket %s", bucket_name)


def delete_bucket_policy(
    bucket_name: str,
    **client_kwargs: Unpack[S3BucketClientKwargs],
) -> None:
    client = get_s3_bucket_client(**client_kwargs)
    deleted = delete_bucket_configuration(
        operation=lambda: client.delete_bucket_policy(Bucket=bucket_name),
        missing_error_codes={"nosuchbucketpolicy", "nosuchbucket"},
        error_message=f"Unable to delete bucket policy for '{bucket_name}'",
    )
    if deleted:
        logger.debug("Deleted policy for bucket %s", bucket_name)
