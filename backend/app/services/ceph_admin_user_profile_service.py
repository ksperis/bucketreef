# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.core.sensitive_data import sanitize_error_detail
from app.models.ceph_admin import CephAdminRgwUserConfigUpdate, CephAdminRgwUserCreate
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.rgw_caps import canonicalize_rgw_caps
from app.utils.rgw_payloads import extract_rgw_user_caps


USER_UPDATE_FIELDS = (
    "display_name",
    "email",
    "suspended",
    "max_buckets",
    "op_mask",
    "system",
    "account_root",
)
USER_UPDATE_FIELD_SET = frozenset(USER_UPDATE_FIELDS)
USER_UPDATE_CLEAR_VALUES: dict[str, Any] = {
    "display_name": "",
    "email": "",
    "max_buckets": 0,
    "op_mask": "",
}
USER_QUOTA_FIELDS = frozenset({"quota_enabled", "quota_max_size_bytes", "quota_max_objects"})


class CephAdminUserProfileServiceError(RuntimeError):
    pass


class CephAdminUserProfileConflictError(CephAdminUserProfileServiceError):
    pass


class CephAdminUserProfileNotFoundError(CephAdminUserProfileServiceError):
    pass


class CephAdminUserProfileUpstreamError(CephAdminUserProfileServiceError):
    pass


class CephAdminUserProfileUnsupportedError(CephAdminUserProfileUpstreamError):
    pass


def _nullable_update(value: Any, field: str, field_set: set[str], cleared_value: Any) -> Any:
    if field not in field_set:
        return None
    return value if value is not None else cleared_value


def _raise_if_unsupported(result: object, detail: str) -> None:
    if isinstance(result, dict) and (result.get("not_found") or result.get("not_implemented")):
        raise CephAdminUserProfileUnsupportedError(detail)


class CephAdminUserProfileMutationService:
    """Apply Ceph Admin RGW user profile mutations without HTTP concerns."""

    def __init__(self, rgw_admin: RGWAdminClient) -> None:
        self.rgw_admin = rgw_admin

    @staticmethod
    def _user_update_params(
        update: CephAdminRgwUserCreate | CephAdminRgwUserConfigUpdate,
        field_set: set[str],
        *,
        clear_nulls: bool,
    ) -> dict[str, Any]:
        if not clear_nulls:
            return {
                field: getattr(update, field) if field in field_set else None
                for field in USER_UPDATE_FIELDS
            }
        return {
            field: (
                _nullable_update(
                    getattr(update, field),
                    field,
                    field_set,
                    USER_UPDATE_CLEAR_VALUES[field],
                )
                if field in USER_UPDATE_CLEAR_VALUES
                else getattr(update, field) if field in field_set else None
            )
            for field in USER_UPDATE_FIELDS
        }

    @staticmethod
    def _upstream_error(exc: RGWAdminError) -> CephAdminUserProfileUpstreamError:
        return CephAdminUserProfileUpstreamError(sanitize_error_detail(str(exc)))

    def ensure_uid_available(self, uid: str, tenant: Optional[str]) -> None:
        try:
            existing = self.rgw_admin.get_user(uid, tenant=tenant, allow_not_found=True)
        except RGWAdminError as exc:
            raise self._upstream_error(exc) from exc
        if existing and not existing.get("not_found"):
            raise CephAdminUserProfileConflictError("RGW user UID already exists")

    def create_user(
        self,
        payload: CephAdminRgwUserCreate,
        *,
        uid: str,
        tenant: Optional[str],
        account_id: Optional[str],
    ) -> Any:
        try:
            if account_id:
                result = self.rgw_admin.create_user_with_account_id(
                    uid=uid,
                    account_id=account_id,
                    display_name=payload.display_name or uid,
                    account_root=payload.account_root if payload.account_root is not None else False,
                    email=payload.email,
                    generate_key=payload.generate_key,
                    extra_params=payload.extra_params or None,
                    tenant=tenant,
                )
            else:
                result = self.rgw_admin.create_user(
                    uid=uid,
                    display_name=payload.display_name or uid,
                    email=payload.email,
                    tenant=tenant,
                    generate_key=payload.generate_key,
                    extra_params=payload.extra_params or None,
                )
        except RGWAdminError as exc:
            raise self._upstream_error(exc) from exc

        if isinstance(result, dict) and result.get("conflict"):
            raise CephAdminUserProfileConflictError("RGW user already exists")
        _raise_if_unsupported(result, "RGW user creation is not supported on this cluster")
        return result

    def apply_created_configuration(
        self,
        payload: CephAdminRgwUserCreate,
        *,
        uid: str,
        tenant: Optional[str],
    ) -> set[str]:
        field_set = set(payload.model_fields_set)
        if USER_UPDATE_FIELD_SET & field_set:
            self._update_user(
                uid,
                tenant,
                self._user_update_params(payload, field_set, clear_nulls=False),
            )
        if payload.caps is not None:
            self._update_caps(uid, tenant, payload.caps.mode, payload.caps.values)
        if any(getattr(payload, field) is not None for field in USER_QUOTA_FIELDS):
            self._update_quota(
                uid,
                tenant,
                max_size_bytes=payload.quota_max_size_bytes,
                max_objects=payload.quota_max_objects,
                enabled=payload.quota_enabled,
            )
        return field_set

    def apply_updated_configuration(
        self,
        update: CephAdminRgwUserConfigUpdate,
        *,
        uid: str,
        tenant: Optional[str],
    ) -> set[str]:
        field_set = set(update.model_fields_set)
        if USER_UPDATE_FIELD_SET & field_set or update.extra_params:
            params = self._user_update_params(update, field_set, clear_nulls=True)
            params["extra_params"] = update.extra_params or None
            self._update_user(uid, tenant, params)

        if "caps" in field_set and update.caps is not None:
            self._update_caps(uid, tenant, update.caps.mode, update.caps.values)

        if USER_QUOTA_FIELDS & field_set:
            self._update_quota(
                uid,
                tenant,
                max_size_bytes=_nullable_update(
                    update.quota_max_size_bytes,
                    "quota_max_size_bytes",
                    field_set,
                    0,
                ),
                max_objects=_nullable_update(
                    update.quota_max_objects,
                    "quota_max_objects",
                    field_set,
                    0,
                ),
                enabled=update.quota_enabled if "quota_enabled" in field_set else True,
            )
        return field_set

    def _update_user(
        self,
        uid: str,
        tenant: Optional[str],
        params: dict[str, Any],
    ) -> None:
        try:
            result = self.rgw_admin.update_user(uid, tenant=tenant, **params)
        except RGWAdminError as exc:
            raise self._upstream_error(exc) from exc
        if isinstance(result, dict) and result.get("conflict"):
            raise CephAdminUserProfileConflictError("RGW user update conflicted")
        _raise_if_unsupported(result, "RGW user update is not supported on this cluster")

    def _update_quota(
        self,
        uid: str,
        tenant: Optional[str],
        *,
        max_size_bytes: Optional[int],
        max_objects: Optional[int],
        enabled: Optional[bool],
    ) -> None:
        try:
            result = self.rgw_admin.set_user_quota(
                uid,
                tenant=tenant,
                max_size_bytes=max_size_bytes,
                max_objects=max_objects,
                enabled=bool(enabled) if enabled is not None else True,
            )
        except RGWAdminError as exc:
            raise self._upstream_error(exc) from exc
        _raise_if_unsupported(result, "RGW user quota update is not supported on this cluster")

    def _update_caps(
        self,
        uid: str,
        tenant: Optional[str],
        mode: str,
        values: list[str],
    ) -> None:
        caps_values = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
        try:
            payload = self.rgw_admin.get_user(uid, tenant=tenant, allow_not_found=True)
            if not payload or (isinstance(payload, dict) and payload.get("not_found")):
                raise CephAdminUserProfileNotFoundError("RGW user not found")
            normalized_payload = payload if isinstance(payload, dict) else {"payload": payload}
            existing_caps = canonicalize_rgw_caps(extract_rgw_user_caps(normalized_payload))
            if mode == "replace":
                if existing_caps:
                    self.rgw_admin.set_user_caps(uid, existing_caps, tenant=tenant, op="rm")
                if caps_values:
                    self.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
            elif mode == "add":
                if caps_values:
                    self.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
            elif caps_values:
                self.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="rm")
        except RGWAdminError as exc:
            raise self._upstream_error(exc) from exc
