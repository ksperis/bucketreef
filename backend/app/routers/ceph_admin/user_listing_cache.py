# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Caches owned by the Ceph Admin RGW user listing."""

from typing import Any, Callable

from app.models.ceph_admin import CephAdminRgwUserSummary
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.routers.ceph_admin.listing_common import (
    EndpointListCacheKey,
    EndpointListingCache,
)

_CACHE = EndpointListingCache()


def get_cached_rgw_users_payload(ctx: CephAdminContext) -> list[Any]:
    return _CACHE.get_rgw_payload(ctx.endpoint.id, ctx.rgw_admin.list_users)


def get_cached_users_listing(
    key: EndpointListCacheKey,
    builder: Callable[[], list[CephAdminRgwUserSummary]],
) -> list[CephAdminRgwUserSummary]:
    return _CACHE.get_listing(key, builder)


def invalidate_users_listing_cache(endpoint_id: int | None = None) -> None:
    _CACHE.invalidate(endpoint_id)
