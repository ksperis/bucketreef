# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from fastapi import APIRouter, FastAPI

from app.routers import browser_bucket_config
from app.routers.ceph_admin import (
    bucket_config as ceph_admin_bucket_config,
    bucket_config_access as ceph_admin_bucket_config_access,
    bucket_config_core as ceph_admin_bucket_config_core,
    bucket_config_rules as ceph_admin_bucket_config_rules,
)
from app.routers.manager import (
    bucket_config as manager_bucket_config,
    bucket_config_access as manager_bucket_config_access,
    bucket_config_core as manager_bucket_config_core,
    bucket_config_rules as manager_bucket_config_rules,
)


def _route_operations(router: APIRouter) -> set[tuple[str, tuple[str, ...]]]:
    return {
        (route.path, tuple(sorted(route.methods or ())))
        for route in router.routes
        if hasattr(route, "methods")
    }


def test_browser_bucket_config_exposes_inspector_reads_and_advanced_s3_settings() -> None:
    inspector_reads = {
        ("/buckets/config/{bucket_name}/logging", ("GET",)),
        ("/buckets/config/{bucket_name}/policy", ("GET",)),
        ("/buckets/config/{bucket_name}/properties", ("GET",)),
        ("/buckets/config/{bucket_name}/stats", ("GET",)),
        ("/buckets/config/{bucket_name}/website", ("GET",)),
    }
    manager_features = (
        manager_bucket_config_core.router,
        manager_bucket_config_access.router,
        manager_bucket_config_rules.router,
    )
    advanced_operations = {
        (f"/buckets/config{path}", methods)
        for router in manager_features
        for path, methods in _route_operations(router)
        if (f"/buckets/config{path}", methods) not in inspector_reads
    }
    # FastAPI may defer include_router() expansion until OpenAPI generation.
    app = FastAPI()
    app.include_router(browser_bucket_config.router)
    operations = {
        (path, (method.upper(),))
        for path, item in app.openapi()["paths"].items()
        for method in item
        if method.lower() in {"get", "post", "put", "patch", "delete"}
    }
    assert operations == inspector_reads | advanced_operations
    assert not any(path.endswith("/quota") for path, _ in operations)


def test_manager_bucket_config_router_aggregates_every_feature_family() -> None:
    feature_routers = (
        manager_bucket_config_core.router,
        manager_bucket_config_access.router,
        manager_bucket_config_rules.router,
    )
    expected_operations = set().union(
        *(_route_operations(router) for router in feature_routers)
    )
    included_routers = tuple(
        route.original_router for route in manager_bucket_config.router.routes
    )

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 36
    assert len(expected_operations) == 36


def test_ceph_admin_bucket_config_router_aggregates_every_feature_family() -> None:
    feature_routers = (
        ceph_admin_bucket_config_core.router,
        ceph_admin_bucket_config_access.router,
        ceph_admin_bucket_config_rules.router,
    )
    expected_operations = set().union(
        *(_route_operations(router) for router in feature_routers)
    )
    included_routers = tuple(
        route.original_router for route in ceph_admin_bucket_config.router.routes
    )

    assert included_routers == feature_routers
    assert sum(len(router.routes) for router in feature_routers) == 37
    assert len(expected_operations) == 37
