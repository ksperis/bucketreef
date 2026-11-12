# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.rgw_quota_update import (
    RgwQuotaUpdate,
    execute_rgw_quota_update,
    prepare_rgw_quota_update,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions


@dataclass(frozen=True)
class S3UserQuotaSnapshot:
    admin: RGWAdminClient
    uid: str
    tenant: str
    max_size_bytes: int | None
    max_objects: int | None


class S3UserQuotaService:
    """Apply RGW user quota changes through the managed user's Admin Ops context."""

    def __init__(self, rgw_context: S3UserRgwContextService) -> None:
        self.rgw_context = rgw_context

    def _resolve_quota_context(
        self,
        context: S3ExecutionContext,
        *,
        admin: RGWAdminClient | None = None,
    ) -> tuple[RGWAdminClient, str, str]:
        endpoint = context.storage_endpoint
        if endpoint is None:
            raise ValueError("storage endpoint is not available for S3 user context")
        require_endpoint_permissions(endpoint, "users_write")
        rgw_admin = admin or self.rgw_context.admin_for_endpoint(endpoint)
        tenant = self.rgw_context.verified_user_tenant(context, rgw_admin)
        uid = context.rgw_user_uid
        if not uid:  # pragma: no cover - guarded by verified_user_tenant
            raise ValueError("S3 user execution context is missing its RGW identity")
        return rgw_admin, uid, tenant

    def update(
        self,
        context: S3ExecutionContext,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
        *,
        admin: RGWAdminClient | None = None,
    ) -> None:
        rgw_admin, uid, tenant = self._resolve_quota_context(context, admin=admin)
        quota = prepare_rgw_quota_update(max_size_gb, max_objects, max_size_unit)
        self._apply(
            rgw_admin,
            uid=uid,
            tenant=tenant,
            quota=quota,
        )

    def capture(self, context: S3ExecutionContext) -> S3UserQuotaSnapshot:
        admin, uid, tenant = self._resolve_quota_context(context)
        try:
            max_size_bytes, max_objects = admin.get_user_quota(
                uid,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to capture RGW user quota: {exc}") from exc
        return S3UserQuotaSnapshot(
            admin=admin,
            uid=uid,
            tenant=tenant,
            max_size_bytes=max_size_bytes,
            max_objects=max_objects,
        )

    def restore(self, snapshot: S3UserQuotaSnapshot) -> None:
        self._apply(
            snapshot.admin,
            uid=snapshot.uid,
            tenant=snapshot.tenant,
            quota=RgwQuotaUpdate(
                max_size_bytes=snapshot.max_size_bytes,
                max_objects=snapshot.max_objects,
                enabled=(
                    snapshot.max_size_bytes is not None
                    or snapshot.max_objects is not None
                ),
            ),
        )

    @staticmethod
    def _apply(
        admin: RGWAdminClient,
        *,
        uid: str,
        tenant: str,
        quota: RgwQuotaUpdate,
    ) -> None:

        def update_remote_quota():
            return admin.set_user_quota(
                uid=uid,
                **({"tenant": tenant} if tenant else {}),
                max_size_bytes=quota.max_size_bytes,
                max_objects=quota.max_objects,
                enabled=quota.enabled,
            )

        execute_rgw_quota_update(
            update_remote_quota,
            subject="user",
            identifier=uid,
        )
