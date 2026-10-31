# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Validate endpoint service identity credentials and RGW access contracts."""
from __future__ import annotations

from typing import Literal

from sqlalchemy.orm import Session

from app.db import EndpointServiceIdentity, StorageEndpoint
from app.services.rgw_admin import RGWAdminClient
from app.services.rgw_admin_identity import extract_ceph_admin_flags
from app.utils.rgw_caps import parse_rgw_caps_permissions
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint

SERVICE_CAPS = {
    "runtime": "accounts=read;user-info-without-keys=read;buckets=read",
    "supervision": "usage=read;buckets=read",
}

ServiceIdentityKind = Literal["runtime", "supervision", "ceph_admin"]
ManagedServiceIdentityKind = Literal["runtime", "supervision"]


class ManagedIdentityKeyDriftError(ValueError):
    """Remote keys differ from the keys tracked by BucketReef."""

    def __init__(self) -> None:
        super().__init__(
            "Managed service identity key drift detected. Remove unexpected RGW keys "
            "externally, then retry service identity configuration."
        )


class EndpointServiceIdentityValidationService:
    """Own the credential, capability, and functional-access validation rules."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def owns(identity: EndpointServiceIdentity, payload: object) -> bool:
        return bool(
            isinstance(payload, dict)
            and isinstance(payload.get("keys"), list)
            and identity.access_key
            and any(
                key.get("access_key") == identity.access_key
                for key in payload.get("keys", [])
                if isinstance(key, dict)
            )
        )

    def validate_managed_keys(
        self,
        identity: EndpointServiceIdentity,
        payload: object,
    ) -> None:
        if not isinstance(payload, dict):
            raise ManagedIdentityKeyDriftError()

        from app.services.durable_key_rotation_service import pending_rotation

        key_type = f"endpoint_{identity.kind}"
        intent = pending_rotation(self.db, identity.endpoint_id, key_type, identity.id)
        allowed = {identity.access_key}
        if intent is not None:
            allowed.update((intent.old_access_key, intent.new_access_key))
        keys = payload.get("keys")
        if (
            not isinstance(keys, list)
            or any(
                not isinstance(key, dict)
                or not isinstance(key.get("access_key"), str)
                or key["access_key"] not in allowed
                for key in keys
            )
            or not any(key["access_key"] == identity.access_key for key in keys)
            or payload.get("swift_keys")
            or payload.get("temp_url_keys")
        ):
            raise ManagedIdentityKeyDriftError()

    @staticmethod
    def validate_payload(kind: ServiceIdentityKind, payload: object) -> None:
        if not isinstance(payload, dict) or not payload:
            raise ValueError(f"{kind} access key is not recognized by RGW.")
        is_admin, is_system = extract_ceph_admin_flags(payload)
        if kind == "ceph_admin":
            if not is_admin or is_system:
                raise ValueError("Ceph Admin requires admin=true and system=false.")
            return
        expected = parse_rgw_caps_permissions(SERVICE_CAPS[kind])
        actual = parse_rgw_caps_permissions(payload.get("caps"))
        if is_admin or is_system or actual != expected:
            raise ValueError(
                f"{kind} identity must have only {SERVICE_CAPS[kind]} and no admin/system flag."
            )

    @classmethod
    def validate_functional_access(
        cls,
        kind: ServiceIdentityKind,
        client: RGWAdminClient,
        *,
        access_key: str | None = None,
        bucket_uid: str | None = None,
        check_buckets: bool = True,
        check_usage: bool = True,
    ) -> dict | None:
        if kind == "runtime":
            return cls._validate_runtime_functional_access(
                client,
                access_key=access_key,
                bucket_uid=bucket_uid,
                check_buckets=check_buckets,
            )
        if kind == "supervision":
            return cls._validate_supervision_functional_access(
                client,
                check_buckets=check_buckets,
                check_usage=check_usage,
            )
        if kind == "ceph_admin":
            return cls._validate_ceph_admin_functional_access(
                client,
                access_key=access_key,
            )
        raise ValueError(f"Unsupported service identity kind: {kind}.")

    @classmethod
    def _validate_runtime_functional_access(
        cls,
        client: RGWAdminClient,
        *,
        access_key: str | None,
        bucket_uid: str | None,
        check_buckets: bool,
    ) -> None:
        if not access_key:
            raise ValueError("Runtime access key is required for validation.")
        payload = client.get_user_by_access_key(access_key, allow_not_found=True)
        cls.validate_payload("runtime", payload)
        uid = payload.get("user_id") or payload.get("uid")
        if (
            not uid
            or payload.get("keys")
            or payload.get("swift_keys")
            or payload.get("temp_url_keys")
        ):
            raise ValueError("Runtime user lookup must succeed without returning keys.")
        client.get_account("RGW00000000000000000", allow_not_found=True)
        if check_buckets:
            client.get_all_buckets(uid=bucket_uid or str(uid), with_stats=True)

    @staticmethod
    def _validate_supervision_functional_access(
        client: RGWAdminClient,
        *,
        check_buckets: bool,
        check_usage: bool,
    ) -> dict | None:
        if check_buckets:
            client.get_all_buckets(with_stats=True)
        if check_usage:
            return client.get_usage(show_entries=False, show_summary=True)
        return None

    @classmethod
    def _validate_ceph_admin_functional_access(
        cls,
        client: RGWAdminClient,
        *,
        access_key: str | None,
    ) -> None:
        if not access_key:
            raise ValueError("Ceph Admin access key is required for validation.")
        cls.validate_payload(
            "ceph_admin",
            client.get_user_by_access_key(access_key, allow_not_found=True),
        )

    @classmethod
    def functional_check(
        cls,
        endpoint: StorageEndpoint,
        *,
        kind: ServiceIdentityKind,
        rgw_uid: str,
        access_key: str,
        secret_key: str,
    ) -> None:
        from app.services.rgw_admin import get_rgw_admin_client

        client = get_rgw_admin_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=resolve_rgw_admin_api_endpoint(endpoint),
            region=endpoint.region,
            verify_tls=endpoint.verify_tls,
        )
        cls.validate_functional_access(
            kind,
            client,
            access_key=access_key,
            bucket_uid=rgw_uid,
        )
