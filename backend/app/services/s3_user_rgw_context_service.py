# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import S3User, StorageEndpoint
from app.core.domain_enums import StorageProvider
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.rgw_payloads import require_rgw_user_identity
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags


class S3UserRgwContextService:
    """Resolve and verify Ceph RGW context for managed S3 users."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_storage_endpoint(self, storage_endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, storage_endpoint_id)
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
        except (RGWAdminError, ValueError) as exc:
            raise ValueError(f"Unable to build admin client for {endpoint.name}: {exc}") from exc

    def admin_for_user(self, s3_user: S3User) -> RGWAdminClient:
        return self.admin_for_endpoint(self.endpoint_for_user(s3_user))

    @staticmethod
    def verified_user_tenant(context: S3ExecutionContext, admin: RGWAdminClient) -> str:
        uid = context.rgw_user_uid
        access_key = context.access_key
        if not uid or not access_key:
            raise ValueError("S3 user execution context is missing its RGW identity")
        tenant = context.rgw_tenant or ""
        remote = admin.get_user(
            uid,
            tenant=tenant or None,
            allow_not_found=True,
        )
        if not remote:
            raise ValueError("RGW user could not be verified")
        require_rgw_user_identity(remote, uid, tenant)
        if not any(
            key.get("access_key") == access_key
            for key in admin.extract_keys(remote)
        ):
            raise ValueError("RGW user no longer owns its stored access key")
        return tenant
