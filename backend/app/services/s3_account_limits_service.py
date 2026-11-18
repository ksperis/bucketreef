# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from app.db import S3Account
from app.models.s3_account import S3AccountUpdate
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
from app.utils.quota_stats import extract_rgw_account_limit


ACCOUNT_LIMIT_FIELDS = ("max_buckets", "max_users", "max_roles", "max_groups")


@dataclass(frozen=True)
class S3AccountLimitsSnapshot:
    admin: RGWAdminClient
    account_id: str
    max_buckets: int | None
    max_users: int | None
    max_roles: int | None
    max_groups: int | None


class S3AccountLimitsService:
    """Apply RGW account limits through the endpoint Admin Ops credentials."""

    def __init__(self, rgw_context: S3AccountRgwContextService) -> None:
        self.rgw_context = rgw_context

    @staticmethod
    def requested(payload: S3AccountUpdate) -> bool:
        return bool(set(ACCOUNT_LIMIT_FIELDS) & payload.model_fields_set)

    def capture(self, account: S3Account) -> S3AccountLimitsSnapshot:
        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        admin = self.rgw_context.admin_for_endpoint(endpoint)
        if admin is None:  # pragma: no cover - guarded by admin_for_endpoint
            raise ValueError("RGW administrative credentials are required")
        require_endpoint_permissions(endpoint, "accounts_write", client=admin)
        try:
            remote = admin.get_account(
                account.rgw_account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to capture RGW account limits: {exc}") from exc
        if not remote or remote.get("not_found"):
            raise ValueError("RGW account could not be verified")
        if remote.get("not_implemented"):
            raise ValueError("RGW account limit updates are not supported on this endpoint")
        return S3AccountLimitsSnapshot(
            admin=admin,
            account_id=account.rgw_account_id,
            max_buckets=extract_rgw_account_limit(remote, "max_buckets"),
            max_users=extract_rgw_account_limit(remote, "max_users"),
            max_roles=extract_rgw_account_limit(remote, "max_roles"),
            max_groups=extract_rgw_account_limit(remote, "max_groups"),
        )

    def update(self, snapshot: S3AccountLimitsSnapshot, payload: S3AccountUpdate) -> None:
        values = {
            field: 0 if getattr(payload, field) is None else getattr(payload, field)
            for field in ACCOUNT_LIMIT_FIELDS
            if field in payload.model_fields_set
        }
        if values:
            self._apply(snapshot.admin, snapshot.account_id, values)

    def restore(self, snapshot: S3AccountLimitsSnapshot) -> None:
        self._apply(
            snapshot.admin,
            snapshot.account_id,
            {
                field: 0 if getattr(snapshot, field) is None else getattr(snapshot, field)
                for field in ACCOUNT_LIMIT_FIELDS
            },
        )

    @staticmethod
    def _apply(admin: RGWAdminClient, account_id: str, values: dict[str, int]) -> None:
        try:
            result = admin.update_account(account_id, **values)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to update RGW account limits: {exc}") from exc
        if result.get("conflict"):
            raise ValueError("RGW account limit update conflicted")
        if result.get("not_found"):
            raise ValueError("RGW account could not be verified")
        if result.get("not_implemented"):
            raise ValueError("RGW account limit updates are not supported on this endpoint")
