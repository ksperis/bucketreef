# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Any, Optional

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import S3User
from app.services import s3_client
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.utils.quota_stats import bytes_to_gb, extract_quota_limits, parse_positive_limit
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_user_payload,
    require_rgw_user_identity,
)
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.usage_stats import aggregate_bucket_usage


logger = logging.getLogger(__name__)


def _extract_max_buckets(payload: Any) -> Optional[int]:
    user_payload = extract_rgw_user_payload(payload)
    return parse_positive_limit(
        user_payload.get("max_buckets")
        or (payload.get("max_buckets") if isinstance(payload, dict) else None)
    )


class S3UserMetricsService:
    """Read RGW usage, quota, and limits for a persisted S3 user."""

    @staticmethod
    def _runtime_client(s3_user: S3User) -> RGWAdminClient:
        endpoint = s3_user.storage_endpoint
        if endpoint is None:
            raise StorageEndpointNotFoundError("Storage endpoint not found for S3 user.")
        return get_endpoint_runtime_rgw_client(endpoint)

    @staticmethod
    def get_interface_bucket_count(s3_user: S3User) -> Optional[int]:
        access_key = (s3_user.rgw_access_key or "").strip()
        secret_key = (s3_user.rgw_secret_key or "").strip()
        if not access_key or not secret_key:
            return None
        try:
            endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(s3_user)
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
        except RuntimeError as exc:
            logger.warning("Unable to list buckets for user %s: %s", s3_user.rgw_user_uid, exc)
            return None

    def get_usage(
        self,
        s3_user: S3User,
    ) -> tuple[Optional[int], Optional[int], Optional[int]]:
        try:
            admin = self._runtime_client(s3_user)
            tenant = s3_user.rgw_tenant
            payload = admin.get_all_buckets(
                uid=s3_user.rgw_user_uid,
                with_stats=True,
                **({"tenant": tenant} if tenant else {}),
            )
        except (RGWAdminError, ValueError) as exc:
            logger.warning(
                "Unable to list buckets with stats for user %s: %s",
                s3_user.rgw_user_uid,
                exc,
            )
            return None, None, None
        return aggregate_bucket_usage(extract_bucket_list(payload))

    def get_quota(
        self,
        s3_user: S3User,
        admin: Optional[RGWAdminClient] = None,
    ) -> tuple[Optional[float], Optional[int]]:
        try:
            rgw_admin = admin or self._runtime_client(s3_user)
        except ValueError as exc:
            logger.warning("Unable to resolve RGW admin for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None
        try:
            tenant = s3_user.rgw_tenant
            max_size_bytes, max_objects = rgw_admin.get_user_quota(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
            )
        except (RGWAdminError, ValueError) as exc:
            logger.warning("Unable to fetch S3 user quota for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None
        return bytes_to_gb(max_size_bytes), max_objects

    def get_limits(
        self,
        s3_user: S3User,
    ) -> tuple[Optional[float], Optional[int], Optional[int]]:
        try:
            rgw_admin = self._runtime_client(s3_user)
        except ValueError as exc:
            logger.warning("Unable to resolve RGW admin for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None, None
        try:
            tenant = s3_user.rgw_tenant
            payload = rgw_admin.get_user(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
                allow_not_found=True,
            ) or {}
            if payload:
                require_rgw_user_identity(payload, s3_user.rgw_user_uid, tenant)
        except (RGWAdminError, ValueError) as exc:
            logger.warning("Unable to fetch S3 user limits for %s: %s", s3_user.rgw_user_uid, exc)
            return None, None, None
        max_size_bytes, max_objects = extract_quota_limits(
            payload,
            keys=("user_quota", "quota"),
        )
        return bytes_to_gb(max_size_bytes), max_objects, _extract_max_buckets(payload)
