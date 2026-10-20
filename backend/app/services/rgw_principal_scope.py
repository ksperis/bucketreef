# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3Account, S3User
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.rgw_identifiers import normalize_rgw_identifier


def resolve_target_tenant(target: S3Account | S3User | S3ExecutionContext) -> str:
    """Return the canonical RGW tenant, using an empty string for the default tenant."""
    return target.rgw_tenant or ""


def resolve_target_admin_uid(target: S3Account | S3ExecutionContext) -> str | None:
    """Return the Admin Ops UID for an execution target.

    Persisted accounts have a canonical root UID enforced by the database. Other
    execution contexts may still represent identities discovered at runtime, such
    as a Ceph Admin bucket owner that exposes only an account identifier.
    """
    if isinstance(target, S3Account):
        return target.rgw_user_uid
    if target.rgw_user_uid:
        uid = target.rgw_user_uid.strip()
        return uid or None
    account_id = normalize_rgw_identifier(target.rgw_account_id)
    return f"{account_id}-admin" if account_id else None
