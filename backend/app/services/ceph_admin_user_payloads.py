# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Collection, Optional

from app.models.ceph_admin import (
    CephAdminRgwAccessKey,
    CephAdminRgwQuotaConfig,
    CephAdminRgwUserDetail,
)
from app.utils.quota_stats import extract_rgw_user_quota_config
from app.utils.rgw_caps import canonicalize_rgw_caps
from app.utils.rgw_payloads import (
    extract_rgw_user_account_id,
    extract_rgw_user_bool,
    extract_rgw_user_caps,
    extract_rgw_user_identity,
    extract_rgw_user_int,
    extract_rgw_user_scalar,
)


@dataclass(frozen=True, slots=True)
class CephAdminRgwUserFields:
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = None
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None


_USER_DETAIL_FIELD_SECTIONS = frozenset({"account", "profile", "status", "limits", "quota"})


def extract_user_fields(
    payload: dict[str, Any],
    sections: Collection[str],
) -> CephAdminRgwUserFields:
    account_id = None
    account_name = None
    display_name = None
    email = None
    suspended = None
    max_buckets = None
    quota_enabled = None
    quota_max_size_bytes = None
    quota_max_objects = None

    if "account" in sections:
        account_id = extract_rgw_user_account_id(payload)
        account_name = extract_rgw_user_scalar(
            payload,
            "account_name",
            top_level_first=True,
        )
    if "profile" in sections:
        display_name = extract_rgw_user_scalar(payload, "display_name")
        email = extract_rgw_user_scalar(payload, "email")
    if "status" in sections:
        suspended = extract_rgw_user_bool(payload, "suspended")
    if "limits" in sections:
        max_buckets = extract_rgw_user_int(payload, "max_buckets")
    if "quota" in sections:
        (
            quota_enabled,
            quota_max_size_bytes,
            quota_max_objects,
        ) = extract_rgw_user_quota_config(payload)

    return CephAdminRgwUserFields(
        account_id=account_id,
        account_name=account_name,
        display_name=display_name,
        email=email,
        suspended=suspended,
        max_buckets=max_buckets,
        quota_enabled=quota_enabled,
        quota_max_size_bytes=quota_max_size_bytes,
        quota_max_objects=quota_max_objects,
    )


def _quota_config(fields: CephAdminRgwUserFields) -> Optional[CephAdminRgwQuotaConfig]:
    if (
        fields.quota_enabled is None
        and fields.quota_max_size_bytes is None
        and fields.quota_max_objects is None
    ):
        return None
    return CephAdminRgwQuotaConfig(
        enabled=fields.quota_enabled,
        max_size_bytes=fields.quota_max_size_bytes,
        max_objects=fields.quota_max_objects,
    )


def build_user_detail(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
    account_name: Optional[str] = None,
    keys: Optional[list[CephAdminRgwAccessKey]] = None,
) -> CephAdminRgwUserDetail:
    fields = extract_user_fields(payload, _USER_DETAIL_FIELD_SECTIONS)
    resolved_uid, resolved_tenant = extract_rgw_user_identity(payload)
    uid = resolved_uid or uid_fallback
    tenant = resolved_tenant if resolved_tenant is not None else tenant_fallback
    return CephAdminRgwUserDetail(
        uid=uid,
        tenant=tenant,
        display_name=fields.display_name,
        email=fields.email,
        account_id=fields.account_id,
        account_name=account_name,
        suspended=fields.suspended,
        admin=extract_rgw_user_bool(payload, "admin"),
        system=extract_rgw_user_bool(payload, "system"),
        account_root=extract_rgw_user_bool(payload, "account_root"),
        max_buckets=fields.max_buckets,
        op_mask=extract_rgw_user_scalar(payload, "op_mask"),
        default_placement=extract_rgw_user_scalar(
            payload,
            "default_placement",
            "default_placement_rule",
        ),
        default_storage_class=extract_rgw_user_scalar(payload, "default_storage_class"),
        caps=canonicalize_rgw_caps(extract_rgw_user_caps(payload)),
        quota=_quota_config(fields),
        keys=keys or [],
    )
