# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.normalize import normalize_optional_string


class RgwAccessKeyRotator:
    """Resolve principals and mask identifiers for durable credential rotations."""

    def detect_user_tenant(
        self,
        admin: RGWAdminClient,
        *,
        uid: str,
        preferred_tenant: Optional[str],
    ) -> Optional[str]:
        attempts: list[Optional[str]] = []
        for candidate in (normalize_optional_string(preferred_tenant), None):
            if candidate in attempts:
                continue
            attempts.append(candidate)

        last_error: Optional[Exception] = None
        for tenant in attempts:
            try:
                payload = admin.get_user(uid, tenant=tenant, allow_not_found=True)
            except RGWAdminError as exc:
                last_error = exc
                continue
            if payload and not payload.get("not_found"):
                return tenant

        if last_error:
            raise ValueError(f"Unable to load RGW user '{uid}': {last_error}") from last_error
        raise ValueError(f"RGW user '{uid}' was not found.")

    def resolve_identity_from_access_key(
        self,
        admin: RGWAdminClient,
        access_key: str,
    ) -> tuple[str, Optional[str]]:
        try:
            payload = admin.get_user_by_access_key(access_key, allow_not_found=True)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to resolve RGW user for access key: {exc}") from exc
        if not payload:
            raise ValueError("Access key is not associated with an RGW user.")

        candidates = self._identity_candidates(payload)
        uid = self._first_normalized_field(candidates, ("uid", "user_id", "user"))
        tenant = self._first_normalized_field(candidates, ("tenant",))
        if not uid:
            raise ValueError("Unable to resolve RGW user identity for this access key.")
        return self._normalize_tenant_qualified_uid(uid, tenant)

    @staticmethod
    def _identity_candidates(payload) -> list[dict]:
        if not isinstance(payload, dict):
            return []
        candidates = [payload]
        nested_user = payload.get("user")
        if isinstance(nested_user, dict):
            candidates.append(nested_user)
        return candidates

    @staticmethod
    def _first_normalized_field(
        candidates: list[dict],
        field_names: tuple[str, ...],
    ) -> Optional[str]:
        for candidate in candidates:
            for field_name in field_names:
                normalized = normalize_optional_string(candidate.get(field_name))
                if normalized:
                    return normalized
        return None

    @staticmethod
    def _normalize_tenant_qualified_uid(
        uid: str,
        tenant: Optional[str],
    ) -> tuple[str, Optional[str]]:
        if "$" not in uid:
            return uid, tenant
        split_tenant, split_uid = uid.split("$", 1)
        if not split_tenant or not split_uid:
            return uid, tenant
        if tenant and tenant != split_tenant:
            raise ValueError("RGW access key identity contains conflicting tenants")
        return split_uid, split_tenant

    @staticmethod
    def mask_access_key(value: Optional[str]) -> Optional[str]:
        normalized = normalize_optional_string(value)
        if not normalized:
            return None
        if len(normalized) <= 8:
            return "***" + normalized[-2:]
        return f"{normalized[:4]}***{normalized[-4:]}"
