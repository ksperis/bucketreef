# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.models.ceph_admin import CephAdminRgwAccountConfigUpdate, CephAdminRgwAccountCreate
from app.services.ceph_admin_errors import (
    CephAdminConflictError,
    CephAdminUpstreamError,
    upstream_error,
)
from app.services.ceph_admin_profile_mutations import (
    nullable_update,
    raise_if_unsupported,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.rgw_payloads import extract_rgw_account_ids


ACCOUNT_UPDATE_FIELDS = (
    "account_name",
    "email",
    "max_users",
    "max_buckets",
    "max_roles",
    "max_groups",
    "max_access_keys",
)
ACCOUNT_UPDATE_FIELD_SET = frozenset(ACCOUNT_UPDATE_FIELDS)
ACCOUNT_UPDATE_CLEAR_VALUES: dict[str, Any] = {
    "account_name": "",
    "email": "",
    "max_users": 0,
    "max_buckets": 0,
    "max_roles": 0,
    "max_groups": 0,
    "max_access_keys": 0,
}
ACCOUNT_QUOTA_FIELDS = frozenset({"quota_enabled", "quota_max_size_bytes", "quota_max_objects"})
BUCKET_QUOTA_FIELDS = frozenset(
    {"bucket_quota_enabled", "bucket_quota_max_size_bytes", "bucket_quota_max_objects"}
)


class CephAdminAccountProfileMutationService:
    """Apply Ceph Admin RGW account profile mutations without HTTP concerns."""

    def __init__(self, rgw_admin: RGWAdminClient) -> None:
        self.rgw_admin = rgw_admin

    @staticmethod
    def _account_update_params(
        update: CephAdminRgwAccountConfigUpdate,
        field_set: set[str],
    ) -> dict[str, Any]:
        return {
            field: nullable_update(
                getattr(update, field),
                field,
                field_set,
                ACCOUNT_UPDATE_CLEAR_VALUES[field],
            )
            for field in ACCOUNT_UPDATE_FIELDS
        }

    def create_account(
        self,
        payload: CephAdminRgwAccountCreate,
        *,
        account_id: str,
        account_name: str,
    ) -> None:
        try:
            result = self.rgw_admin.create_account(
                account_id=account_id,
                account_name=account_name,
                tenant=payload.tenant,
                email=payload.email,
                max_users=payload.max_users,
                max_buckets=payload.max_buckets,
                max_roles=payload.max_roles,
                max_groups=payload.max_groups,
                max_access_keys=payload.max_access_keys,
                extra_params=payload.extra_params or None,
            )
        except RGWAdminError as exc:
            raise upstream_error(exc) from exc
        if isinstance(result, dict) and result.get("conflict"):
            raise CephAdminConflictError("RGW account already exists")
        raise_if_unsupported(result, "RGW account creation is not supported on this cluster")

        returned_ids = extract_rgw_account_ids(result) if isinstance(result, dict) else set()
        if returned_ids != {account_id}:
            raise CephAdminUpstreamError(
                "RGW did not confirm the requested account identity"
            )

    def apply_created_quotas(
        self,
        payload: CephAdminRgwAccountCreate,
        *,
        account_id: str,
    ) -> tuple[bool, bool]:
        account_quota_updated = any(
            getattr(payload, field) is not None for field in ACCOUNT_QUOTA_FIELDS
        )
        if account_quota_updated:
            self._update_quota(
                account_id,
                quota_type="account",
                max_size_bytes=payload.quota_max_size_bytes,
                max_objects=payload.quota_max_objects,
                enabled=payload.quota_enabled,
            )

        bucket_quota_updated = any(
            getattr(payload, field) is not None for field in BUCKET_QUOTA_FIELDS
        )
        if bucket_quota_updated:
            self._update_quota(
                account_id,
                quota_type="bucket",
                max_size_bytes=payload.bucket_quota_max_size_bytes,
                max_objects=payload.bucket_quota_max_objects,
                enabled=payload.bucket_quota_enabled,
            )
        return account_quota_updated, bucket_quota_updated

    def apply_updated_configuration(
        self,
        update: CephAdminRgwAccountConfigUpdate,
        *,
        account_id: str,
    ) -> set[str]:
        field_set = set(update.model_fields_set)
        if ACCOUNT_UPDATE_FIELD_SET & field_set or update.extra_params:
            params = self._account_update_params(update, field_set)
            params["extra_params"] = update.extra_params or None
            self._update_account(account_id, params)

        if ACCOUNT_QUOTA_FIELDS & field_set:
            self._update_quota(
                account_id,
                quota_type="account",
                max_size_bytes=nullable_update(
                    update.quota_max_size_bytes,
                    "quota_max_size_bytes",
                    field_set,
                    0,
                ),
                max_objects=nullable_update(
                    update.quota_max_objects,
                    "quota_max_objects",
                    field_set,
                    0,
                ),
                enabled=update.quota_enabled,
            )

        if BUCKET_QUOTA_FIELDS & field_set:
            self._update_quota(
                account_id,
                quota_type="bucket",
                max_size_bytes=nullable_update(
                    update.bucket_quota_max_size_bytes,
                    "bucket_quota_max_size_bytes",
                    field_set,
                    0,
                ),
                max_objects=nullable_update(
                    update.bucket_quota_max_objects,
                    "bucket_quota_max_objects",
                    field_set,
                    0,
                ),
                enabled=update.bucket_quota_enabled,
            )
        return field_set

    def _update_account(self, account_id: str, params: dict[str, Any]) -> None:
        try:
            result = self.rgw_admin.update_account(account_id, **params)
        except RGWAdminError as exc:
            raise upstream_error(exc) from exc
        if isinstance(result, dict) and result.get("conflict"):
            raise CephAdminConflictError("RGW account update conflicted")
        raise_if_unsupported(result, "RGW account update is not supported on this cluster")
        if isinstance(result, dict):
            returned_ids = extract_rgw_account_ids(result)
            if returned_ids and returned_ids != {account_id}:
                raise CephAdminUpstreamError(
                    "RGW returned a different account identity"
                )

    def _update_quota(
        self,
        account_id: str,
        *,
        quota_type: str,
        max_size_bytes: Optional[int],
        max_objects: Optional[int],
        enabled: Optional[bool],
    ) -> None:
        try:
            result = self.rgw_admin.set_account_quota(
                account_id,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                quota_type=quota_type,
                enabled=bool(enabled) if enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise upstream_error(exc) from exc
        quota_label = "bucket quota" if quota_type == "bucket" else "account quota"
        raise_if_unsupported(result, f"RGW {quota_label} update is not supported on this cluster")
