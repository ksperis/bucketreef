# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from collections.abc import Callable
from typing import Literal

from app.db import StorageEndpoint, StorageProvider
from app.models.storage_endpoint import StorageEndpointAdminOpsPermissions
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.rgw_caps import parse_rgw_caps_permissions

logger = logging.getLogger(__name__)

RGWAdminClientFactory = Callable[..., RGWAdminClient]
AdminOpsPermissionName = Literal[
    "users_read",
    "users_write",
    "buckets_read",
    "buckets_write",
    "accounts_read",
    "accounts_write",
    "usage_read",
    "usage_write",
]


def _empty_permissions() -> StorageEndpointAdminOpsPermissions:
    return StorageEndpointAdminOpsPermissions.empty()


def _allows(scope_permissions: set[str], permission: str) -> bool:
    normalized_permission = permission.strip().lower()
    return bool(
        normalized_permission
        and (
            "*" in scope_permissions
            or normalized_permission in scope_permissions
        )
    )


def admin_ops_permissions_from_caps(raw_caps: object) -> StorageEndpointAdminOpsPermissions:
    parsed_caps = parse_rgw_caps_permissions(raw_caps)
    users_permissions = parsed_caps.get("users", set())
    buckets_permissions = parsed_caps.get("buckets", set())
    accounts_permissions = parsed_caps.get("accounts", set())
    users_write = _allows(users_permissions, "write")
    buckets_write = _allows(buckets_permissions, "write")
    accounts_write = _allows(accounts_permissions, "write")
    return StorageEndpointAdminOpsPermissions(
        users_read=_allows(users_permissions, "read"),
        users_write=users_write,
        buckets_read=_allows(buckets_permissions, "read"),
        buckets_write=buckets_write,
        accounts_read=_allows(accounts_permissions, "read"),
        accounts_write=accounts_write,
        usage_read=_allows(parsed_caps.get("usage", set()), "read"),
        usage_write=_allows(parsed_caps.get("usage", set()), "write"),
    )


def resolve_storage_endpoint_admin_ops_permissions(
    endpoint: StorageEndpoint,
    *,
    provider: StorageProvider,
    client_factory: RGWAdminClientFactory,
) -> StorageEndpointAdminOpsPermissions:
    if provider != StorageProvider.CEPH:
        return _empty_permissions()
    if not endpoint.admin_access_key or not endpoint.admin_secret_key:
        return _empty_permissions()

    from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
    admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
    if not admin_endpoint:
        return _empty_permissions()

    try:
        admin_client = client_factory(
            access_key=endpoint.admin_access_key,
            secret_key=endpoint.admin_secret_key,
            endpoint=admin_endpoint,
            region=endpoint.region,
            verify_tls=endpoint.verify_tls,
        )
        user_payload = admin_client.get_user_by_access_key(
            endpoint.admin_access_key,
            allow_not_found=True,
        )
        if not user_payload:
            return _empty_permissions()
        return admin_ops_permissions_from_caps(user_payload.get("caps"))
    except RGWAdminError as exc:
        logger.warning(
            "Unable to evaluate admin ops permissions for endpoint id=%s name=%s: %s",
            endpoint.id,
            endpoint.name,
            exc,
        )
        return _empty_permissions()


def has_account_provisioning_permissions(
    permissions: StorageEndpointAdminOpsPermissions,
) -> bool:
    """Return whether Admin Ops can provision and inspect Manager/Portal RGW resources."""
    return bool(
        permissions.users_read
        and permissions.users_write
        and permissions.accounts_read
        and permissions.accounts_write
    )


def require_endpoint_permissions(
    endpoint: StorageEndpoint,
    *required: AdminOpsPermissionName,
    client: RGWAdminClient | None = None,
) -> None:
    from app.services.rgw_endpoint_clients import get_endpoint_admin_rgw_client
    admin = client or get_endpoint_admin_rgw_client(endpoint)
    payload = admin.get_user_by_access_key(endpoint.admin_access_key, allow_not_found=True)
    permissions = admin_ops_permissions_from_caps(payload.get("caps") if isinstance(payload, dict) else None)
    missing = [permission for permission in required if not getattr(permissions, permission)]
    if missing:
        raise ValueError("Admin Ops is missing required permissions: " + ", ".join(missing))
