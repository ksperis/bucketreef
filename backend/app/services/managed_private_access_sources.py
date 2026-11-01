# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared source model and execution-context helpers for managed private access."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget

RemotePrincipalType = Literal["iam_user", "rgw_user"]


@dataclass(frozen=True)
class ManagedPrivateAccessSource:
    kind: str
    identifier: int
    remote_principal_type: RemotePrincipalType
    remote_principal_identifier: str
    iam_username: str | None


def source_ids(context: S3ExecutionTarget) -> tuple[int | None, int | None, int | None]:
    if isinstance(context, S3ExecutionContext):
        return context.s3_connection_id, context.s3_user_id, context.id
    return None, None, context.id


def iam_source_reference(context: S3ExecutionTarget) -> tuple[str, int] | None:
    connection_id, s3_user_id, account_id = source_ids(context)
    if isinstance(connection_id, int) and connection_id > 0:
        return "connection", connection_id
    if s3_user_id is not None:
        return None
    if isinstance(account_id, int) and account_id > 0:
        return "account", account_id
    return None
