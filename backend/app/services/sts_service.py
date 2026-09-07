# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Mapping
from datetime import datetime
from typing import Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.services.aws_client_config import build_interactive_aws_config
from app.utils.time import normalize_utc, utcnow

settings = get_settings()


def get_sts_client(
    access_key: Optional[str],
    secret_key: Optional[str],
    endpoint: Optional[str] = None,
    session_token: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
):
    if not endpoint:
        raise RuntimeError("STS endpoint is not configured")
    return boto3.client(
        "sts",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        aws_session_token=session_token,
        region_name=region or settings.seed_s3_region,
        verify=verify_tls,
        config=build_interactive_aws_config(),
    )


def get_session_token(
    duration_seconds: int,
    access_key: str,
    secret_key: str,
    endpoint: Optional[str] = None,
    session_token: Optional[str] = None,
    region: Optional[str] = None,
    verify_tls: bool = True,
) -> tuple[str, str, str, datetime]:
    client = get_sts_client(
        access_key,
        secret_key,
        endpoint=endpoint,
        session_token=session_token,
        region=region,
        verify_tls=verify_tls,
    )
    try:
        resp = client.get_session_token(DurationSeconds=duration_seconds)
        creds = resp.get("Credentials") if isinstance(resp, Mapping) else None
        if not isinstance(creds, Mapping):
            raise RuntimeError("STS get session token did not return credentials")
        access = creds.get("AccessKeyId")
        secret = creds.get("SecretAccessKey")
        token = creds.get("SessionToken")
        expiration_raw = creds.get("Expiration")
        if any(not isinstance(value, str) or not value for value in (access, secret, token)):
            raise RuntimeError("STS get session token did not return credentials")
        try:
            expiration = expiration_raw if isinstance(expiration_raw, datetime) else datetime.fromisoformat(expiration_raw)
            expiration = normalize_utc(expiration, name="STS expiration")
        except (TypeError, ValueError):
            raise RuntimeError("STS get session token did not return a valid timezone-aware expiration") from None
        if expiration <= utcnow():
            raise RuntimeError("STS get session token returned expired credentials")
        return access, secret, token, expiration
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"Unable to get session token: {exc}") from exc
