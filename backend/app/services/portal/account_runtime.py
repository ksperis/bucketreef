# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Optional

from app.db import PortalStorageSpaceMetadata, S3Account
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
from app.utils.quota_stats import extract_positive_limit, extract_quota_limits
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.s3_endpoint import resolve_s3_client_kwargs
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint


logger = logging.getLogger(__name__)


class PortalAccountRuntimeMixin:
    def _is_active_status(self, status: Optional[str], default: bool = True) -> bool:
        if status is None:
            return default
        normalized = status.strip().lower()
        if not normalized:
            return default
        if normalized == "active":
            return True
        if normalized == "inactive":
            return False
        return default

    def _account_credentials(self, account: S3Account) -> tuple[str, str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3Account is missing root credentials")
        return access_key, secret_key

    def _s3_client_kwargs(self, account: S3Account) -> dict:
        return resolve_s3_client_kwargs(account)

    def _runtime_read_for_account(self, account: S3Account) -> RGWAdminClient:
        admin = self._runtime_for_account(account)
        if admin is None:
            raise RuntimeError("Runtime Read Ops credentials are missing for this endpoint.")
        return admin

    def _runtime_for_account(self, account: S3Account) -> Optional[RGWAdminClient]:
        endpoint = account.storage_endpoint
        if not endpoint:
            return None
        admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
        runtime = endpoint.service_identity("runtime")
        if (
            not admin_endpoint
            or runtime is None
            or runtime.status != "ready"
            or not runtime.access_key
            or not runtime.secret_key
        ):
            return None
        try:
            return get_endpoint_runtime_rgw_client(endpoint)
        except Exception as exc:
            logger.warning("Unable to build admin client for quota lookup: %s", exc)
            return None

    def _account_limits(self, account: S3Account) -> tuple[Optional[int], Optional[int], Optional[int]]:
        admin = self._runtime_for_account(account)
        if not admin:
            return None, None, None
        try:
            payload = admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            ) or {}
        except RGWAdminError as exc:
            logger.warning("Unable to fetch portal account limits for %s: %s", account.rgw_account_id, exc)
            return None, None, None
        max_size_bytes, max_objects = extract_quota_limits(payload, keys=("quota", "account_quota"))
        return max_size_bytes, max_objects, extract_positive_limit(payload, "max_buckets")

    def _admin_bucket_list(self, account: S3Account, admin: Optional[RGWAdminClient] = None) -> list[dict]:
        rgw_admin = admin or self._runtime_read_for_account(account)
        uid = account.rgw_account_id or account.rgw_user_uid
        if not uid:
            return []
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
        return extract_bucket_list(payload)

    def _admin_bucket_info(
        self,
        account: S3Account,
        bucket_name: str,
        admin: Optional[RGWAdminClient] = None,
    ) -> Optional[dict]:
        normalized_bucket = (bucket_name or "").strip()
        if not normalized_bucket:
            return None
        in_scope = (
            self.db.query(PortalStorageSpaceMetadata.id)
            .filter(
                PortalStorageSpaceMetadata.account_id == account.id,
                PortalStorageSpaceMetadata.bucket_name == normalized_bucket,
            )
            .first()
        )
        if in_scope is None:
            return None
        rgw_admin = admin or self._runtime_read_for_account(account)
        return rgw_admin.get_bucket_info(
            normalized_bucket,
            allow_not_found=True,
            uid=account.rgw_user_uid,
        )
