# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError


def probe_iam_list_users(
    access_key: str | None,
    secret_key: str | None,
    *,
    endpoint: str | None,
    region: str | None = None,
    verify_tls: bool = True,
    client_factory: Callable[..., Any],
) -> bool:
    """Return whether credentials can perform the read-only IAM ListUsers probe."""

    if not access_key or not secret_key:
        return False
    try:
        client_factory(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=endpoint,
            region=region,
            verify_tls=verify_tls,
        ).list_users(MaxItems=1)
        return True
    except (ClientError, BotoCoreError):
        return False
