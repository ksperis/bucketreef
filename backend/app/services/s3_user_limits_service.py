# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from app.models.s3_user import S3UserUpdate
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
from app.utils.quota_stats import extract_rgw_user_limit
from app.utils.rgw_payloads import require_rgw_user_identity


@dataclass(frozen=True)
class S3UserLimitsSnapshot:
    admin: RGWAdminClient
    uid: str
    tenant: str
    max_buckets: int | None


class S3UserLimitsService:
    """Apply managed RGW user limits through the endpoint Admin Ops credentials."""

    def __init__(self, rgw_context: S3UserRgwContextService) -> None:
        self.rgw_context = rgw_context

    @staticmethod
    def requested(payload: S3UserUpdate) -> bool:
        return "max_buckets" in payload.model_fields_set

    def capture(self, context: S3ExecutionContext) -> S3UserLimitsSnapshot:
        endpoint = self.rgw_context.endpoint_for_context(context)
        admin = self.rgw_context.admin_for_endpoint(endpoint)
        require_endpoint_permissions(endpoint, "users_write", client=admin)
        tenant = self.rgw_context.verified_user_tenant(context, admin)
        uid = context.rgw_user_uid
        if not uid:  # pragma: no cover - guarded by verified_user_tenant
            raise ValueError("S3 user execution context is missing its RGW identity")
        try:
            remote = admin.get_user(uid, tenant=tenant or None, allow_not_found=True)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to capture RGW user limits: {exc}") from exc
        if not remote:
            raise ValueError("RGW user could not be verified")
        require_rgw_user_identity(remote, uid, tenant)
        return S3UserLimitsSnapshot(
            admin=admin,
            uid=uid,
            tenant=tenant,
            max_buckets=extract_rgw_user_limit(remote, "max_buckets"),
        )

    def update(self, snapshot: S3UserLimitsSnapshot, payload: S3UserUpdate) -> None:
        if "max_buckets" not in payload.model_fields_set:
            return
        self._apply(
            snapshot,
            0 if payload.max_buckets is None else payload.max_buckets,
        )

    def restore(self, snapshot: S3UserLimitsSnapshot) -> None:
        self._apply(snapshot, 0 if snapshot.max_buckets is None else snapshot.max_buckets)

    @staticmethod
    def _apply(snapshot: S3UserLimitsSnapshot, max_buckets: int) -> None:
        try:
            result = snapshot.admin.update_user(
                snapshot.uid,
                tenant=snapshot.tenant or None,
                max_buckets=max_buckets,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to update RGW user limits: {exc}") from exc
        if result.get("conflict"):
            raise ValueError("RGW user limit update conflicted")
        if result.get("not_found"):
            raise ValueError("RGW user could not be verified")
