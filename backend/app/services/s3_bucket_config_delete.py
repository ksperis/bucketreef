# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Container

from botocore.exceptions import BotoCoreError, ClientError

from app.utils.aws_errors import aws_error_code


def delete_bucket_configuration(
    *,
    operation: Callable[[], object],
    missing_error_codes: Container[str],
    error_message: str,
) -> bool:
    """Run an idempotent bucket-configuration delete.

    Returns ``False`` when the provider reports that the configuration (or its
    bucket) is already absent, and ``True`` after a successful delete.
    """

    try:
        operation()
    except ClientError as exc:
        if aws_error_code(exc, lowercase=True) in missing_error_codes:
            return False
        raise RuntimeError(f"{error_message}: {exc}") from exc
    except BotoCoreError as exc:
        raise RuntimeError(f"{error_message}: {exc}") from exc
    return True
