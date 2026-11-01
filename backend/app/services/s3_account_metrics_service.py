# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.quota_stats import (
    bytes_to_gb,
    extract_rgw_account_positive_limit,
    extract_rgw_account_quota_limits,
)
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.usage_stats import aggregate_bucket_usage


logger = logging.getLogger(__name__)


class S3AccountMetricsService:
    """Read RGW usage, quota, and account limits for an account execution target."""

    @staticmethod
    def runtime_client(
        account: S3ExecutionTarget,
        *,
        allow_missing: bool = False,
    ) -> Optional[RGWAdminClient]:
        try:
            return get_endpoint_runtime_rgw_client(account.storage_endpoint)
        except (ValueError, RGWAdminError):
            if allow_missing:
                return None
            raise

    def get_usage(
        self,
        account: S3ExecutionTarget,
    ) -> tuple[Optional[int], Optional[int], Optional[int]]:
        admin = self.runtime_client(account, allow_missing=True)
        if not admin:
            return None, None, None
        try:
            uid = account.rgw_user_uid
            if not uid:
                return None, None, None
            payload = admin.get_all_buckets(
                uid=uid,
                with_stats=True,
                **({"tenant": account.rgw_tenant} if account.rgw_tenant else {}),
            )
        except RGWAdminError as exc:
            logger.warning("Unable to list buckets for account %s: %s", account.rgw_account_id, exc)
            return None, None, None
        used_bytes, used_objects, bucket_count = aggregate_bucket_usage(
            extract_bucket_list(payload)
        )
        return used_bytes, used_objects, bucket_count

    def get_quota(
        self,
        account: S3ExecutionTarget,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        rgw_admin = admin or self.runtime_client(account, allow_missing=True)
        if not rgw_admin:
            return None, None
        try:
            max_size_bytes, max_objects = rgw_admin.get_account_quota(account.rgw_account_id)
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account quota for %s: %s", account.rgw_account_id, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_limits(
        self,
        account: S3ExecutionTarget,
    ) -> tuple[Optional[float], Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        rgw_admin = self.runtime_client(account, allow_missing=True)
        if not rgw_admin:
            return None, None, None, None, None, None
        try:
            payload = rgw_admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            ) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch account limits for %s: %s", account.rgw_account_id, exc)
            return None, None, None, None, None, None
        max_size_bytes, max_objects = extract_rgw_account_quota_limits(payload)
        return (
            bytes_to_gb(max_size_bytes),
            max_objects,
            extract_rgw_account_positive_limit(payload, "max_buckets"),
            extract_rgw_account_positive_limit(payload, "max_users"),
            extract_rgw_account_positive_limit(payload, "max_roles"),
            extract_rgw_account_positive_limit(payload, "max_groups"),
        )
