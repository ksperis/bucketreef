# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import S3User, StorageEndpoint, StorageProvider
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.utils.rgw_payloads import require_rgw_user_identity
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags


class S3UserRgwContextService:
    """Resolve and verify Ceph RGW context for managed S3 users."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_storage_endpoint(self, storage_endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.scalar(
            select(StorageEndpoint).where(StorageEndpoint.id == storage_endpoint_id)
        )
        if not endpoint:
            raise StorageEndpointNotFoundError("Storage endpoint not found.")
        if endpoint.provider != StorageProvider.CEPH.value:
            raise ValueError("Only Ceph endpoints are allowed for S3 users.")
        if not resolve_feature_flags(endpoint).admin_enabled:
            raise ValueError("Admin operations are disabled for this endpoint.")
        return endpoint

    @staticmethod
    def endpoint_for_user(s3_user: S3User) -> StorageEndpoint:
        endpoint = s3_user.storage_endpoint
        if endpoint is None:
            raise StorageEndpointNotFoundError("Storage endpoint not found for S3 user.")
        return endpoint

    @staticmethod
    def admin_for_endpoint(endpoint: StorageEndpoint) -> RGWAdminClient:
        try:
            admin_endpoint = resolve_admin_endpoint(endpoint)
            if not admin_endpoint:
                raise ValueError("Admin operations are disabled for this endpoint.")
            return get_endpoint_admin_rgw_client(endpoint)
        except Exception as exc:
            raise ValueError(f"Unable to build admin client for {endpoint.name}: {exc}") from exc

    def admin_for_user(self, s3_user: S3User) -> RGWAdminClient:
        return self.admin_for_endpoint(self.endpoint_for_user(s3_user))

    @staticmethod
    def verified_user_tenant(s3_user: S3User, admin: RGWAdminClient) -> str:
        tenant = s3_user.rgw_tenant
        remote = admin.get_user(
            s3_user.rgw_user_uid,
            tenant=tenant or None,
            allow_not_found=True,
        )
        if not remote:
            raise ValueError("RGW user could not be verified")
        require_rgw_user_identity(remote, s3_user.rgw_user_uid, tenant)
        if not any(
            key.get("access_key") == s3_user.rgw_access_key
            for key in admin.extract_keys(remote)
        ):
            raise ValueError("RGW user no longer owns its stored access key")
        return tenant
