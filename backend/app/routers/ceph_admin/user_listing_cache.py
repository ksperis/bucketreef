# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Caches owned by the Ceph Admin RGW user listing."""

from typing import Any, Callable

from fastapi import status

from app.models.ceph_admin import CephAdminRgwUserSummary
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.listing_common import (
    EndpointListCacheKey,
    EndpointListingCache,
)
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception

_CACHE = EndpointListingCache()


def get_cached_rgw_users_payload(ctx: CephAdminContext) -> list[Any]:
    def fetch_payload() -> list[Any]:
        try:
            payload = ctx.rgw_admin.list_users()
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        return payload or []

    return _CACHE.get_payload(ctx.endpoint.id, fetch_payload)


def get_cached_users_listing(
    key: EndpointListCacheKey,
    builder: Callable[[], list[CephAdminRgwUserSummary]],
) -> list[CephAdminRgwUserSummary]:
    return _CACHE.get_listing(key, builder)


def invalidate_users_listing_cache(endpoint_id: int | None = None) -> None:
    _CACHE.invalidate(endpoint_id)
