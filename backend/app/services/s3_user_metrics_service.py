# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from app.services import s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.quota_stats import (
    bytes_to_gb,
    extract_rgw_user_positive_limit,
    extract_rgw_user_quota_limits,
)
from app.utils.rgw_payloads import (
    extract_bucket_list,
    require_rgw_user_identity,
)
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.usage_stats import aggregate_bucket_usage


logger = logging.getLogger(__name__)

class S3UserMetricsService:
    """Read RGW usage, quota, and limits for an S3 user execution context."""

    @staticmethod
    def runtime_client(
        context: S3ExecutionContext,
        *,
        allow_missing: bool = False,
    ) -> Optional[RGWAdminClient]:
        endpoint = context.storage_endpoint
        if endpoint is None:
            if allow_missing:
                return None
            raise ValueError("storage endpoint is not available for S3 user context")
        try:
            return get_endpoint_runtime_rgw_client(endpoint)
        except (ValueError, RGWAdminError):
            if allow_missing:
                return None
            raise

    @staticmethod
    def get_interface_bucket_count(context: S3ExecutionContext) -> Optional[int]:
        access_key = (context.access_key or "").strip()
        secret_key = (context.secret_key or "").strip()
        if not access_key or not secret_key:
            return None
        try:
            endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(context)
            buckets = s3_client.list_buckets(
                access_key=access_key,
                secret_key=secret_key,
                endpoint=endpoint,
                region=region,
                force_path_style=force_path_style,
                verify_tls=verify_tls,
            )
            return len(
                [bucket for bucket in buckets if isinstance(bucket, dict) and bucket.get("name")]
            )
        except s3_client.S3OperationError as exc:
            logger.warning("Unable to list buckets for user %s: %s", context.rgw_user_uid, exc)
            return None

    def get_usage(
        self,
        context: S3ExecutionContext,
    ) -> tuple[Optional[int], Optional[int], Optional[int]]:
        admin = self.runtime_client(context, allow_missing=True)
        uid = context.rgw_user_uid
        if not admin or not uid:
            return None, None, None
        try:
            tenant = context.rgw_tenant
            payload = admin.get_all_buckets(
                uid=uid,
                with_stats=True,
                **({"tenant": tenant} if tenant else {}),
            )
        except (RGWAdminError, ValueError) as exc:
            logger.warning(
                "Unable to list buckets with stats for user %s: %s",
                uid,
                exc,
            )
            return None, None, None
        return aggregate_bucket_usage(extract_bucket_list(payload))

    def get_quota(
        self,
        context: S3ExecutionContext,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        rgw_admin = admin or self.runtime_client(context, allow_missing=True)
        if not rgw_admin:
            return None, None
        return self.get_quota_with_admin(context.rgw_user_uid, context.rgw_tenant, rgw_admin)

    @staticmethod
    def get_quota_with_admin(
        rgw_user_uid: Optional[str],
        rgw_tenant: Optional[str],
        admin: RGWAdminClient,
    ) -> tuple[Optional[float], Optional[int]]:
        if not rgw_user_uid:
            return None, None
        try:
            max_size_bytes, max_objects = admin.get_user_quota(
                rgw_user_uid,
                tenant=rgw_tenant or None,
            )
        except (RGWAdminError, ValueError) as exc:
            logger.warning("Unable to fetch S3 user quota for %s: %s", rgw_user_uid, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_limits(
        self,
        context: S3ExecutionContext,
    ) -> tuple[Optional[float], Optional[int], Optional[int]]:
        rgw_admin = self.runtime_client(context, allow_missing=True)
        uid = context.rgw_user_uid
        if not rgw_admin or not uid:
            return None, None, None
        try:
            tenant = context.rgw_tenant
            payload = rgw_admin.get_user(
                uid,
                tenant=tenant or None,
                allow_not_found=True,
            ) or {}
            if payload:
                require_rgw_user_identity(payload, uid, tenant)
        except (RGWAdminError, ValueError) as exc:
            logger.warning("Unable to fetch S3 user limits for %s: %s", uid, exc)
            return None, None, None
        max_size_bytes, max_objects = extract_rgw_user_quota_limits(payload)
        return (
            bytes_to_gb(max_size_bytes),
            max_objects,
            extract_rgw_user_positive_limit(payload, "max_buckets"),
        )
