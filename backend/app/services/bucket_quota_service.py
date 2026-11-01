# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.sensitive_data import sanitized_error_log_detail
from app.models.bucket import BucketQuotaUpdate
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
from app.services.rgw_principal_scope import resolve_target_admin_uid, resolve_target_tenant
from app.services.s3_execution_context import (
    S3ExecutionContext,
    S3ExecutionTarget,
    is_ceph_admin_execution_context,
)
from app.utils.rgw_identifiers import resolve_account_scope
from app.utils.size_units import size_to_bytes
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_feature_flags


class BucketQuotaService:
    def _rgw_bucket_quota_admin_for_context(self, execution_context: S3ExecutionTarget):
        if isinstance(execution_context, S3ExecutionContext) and execution_context.context_kind == "openstack_project":
            raise RuntimeError("Admin Ops are not available for OpenStack project contexts")
        endpoint = execution_context.storage_endpoint
        if endpoint is None:
            raise RuntimeError("Storage endpoint is not configured for this context")
        flags = resolve_feature_flags(endpoint)
        if not flags.admin_enabled:
            raise RuntimeError("Admin API is disabled for this endpoint")
        access_key = (endpoint.admin_access_key or "").strip()
        secret_key = (endpoint.admin_secret_key or "").strip()
        if not access_key or not secret_key:
            raise RuntimeError("Endpoint admin credentials are not configured for this endpoint")
        try:
            admin_endpoint = resolve_admin_endpoint(endpoint)
            if not admin_endpoint:
                raise RuntimeError("Admin endpoint is not configured for this endpoint")
            return get_endpoint_admin_rgw_client(endpoint)
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to initialize bucket quota admin client: {exc}") from exc

    def _resolve_bucket_quota_scope(
        self,
        execution_context: S3ExecutionTarget,
        *,
        rgw_tenant: str | None = None,
    ) -> tuple[str | None, str | None, str]:
        account_id, tenant = resolve_account_scope(execution_context.rgw_account_id)
        is_ceph_admin = is_ceph_admin_execution_context(execution_context)
        if is_ceph_admin and rgw_tenant is not None:
            tenant = rgw_tenant or None
        elif not is_ceph_admin or not tenant:
            tenant = resolve_target_tenant(execution_context) or None
        root_uid = resolve_target_admin_uid(execution_context)
        if root_uid:
            return account_id, tenant, root_uid

        raise RuntimeError("Unable to set bucket quota: authorized owner scope is missing")

    def set_bucket_quota(
        self,
        name: str,
        execution_context: S3ExecutionTarget,
        payload: BucketQuotaUpdate,
        rgw_admin: RGWAdminClient | None = None,
        rgw_tenant: str | None = None,
    ) -> None:
        client = rgw_admin or self._rgw_bucket_quota_admin_for_context(execution_context)
        _account_id, tenant, root_uid = self._resolve_bucket_quota_scope(
            execution_context,
            rgw_tenant=rgw_tenant,
        )
        max_size_bytes = None
        if payload.max_size_gb is not None:
            try:
                max_size_bytes = size_to_bytes(payload.max_size_gb, payload.max_size_unit)
            except ValueError as exc:
                raise ValueError(sanitized_error_log_detail(exc)) from exc
        enabled = max_size_bytes is not None or payload.max_objects is not None
        try:
            response = client.set_bucket_quota(
                bucket=name,
                tenant=tenant,
                uid=root_uid,
                max_size_bytes=max_size_bytes,
                max_objects=payload.max_objects,
                enabled=enabled,
            )
        except RGWAdminError as exc:
            raise RuntimeError(f"Unable to set bucket quota: {exc}") from exc
        if isinstance(response, dict) and response.get("not_found"):
            raise RuntimeError("Unable to set bucket quota: bucket or owner scope not found")
        if isinstance(response, dict) and response.get("not_implemented"):
            raise RuntimeError("Unable to set bucket quota: operation not supported on this cluster")


def get_bucket_quota_service() -> BucketQuotaService:
    return BucketQuotaService()
