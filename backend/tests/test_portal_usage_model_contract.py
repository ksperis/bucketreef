# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.db import PortalAccountRole, S3Account, User, UserRole
from app.main import app
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from app.models.portal_usage import PortalStorageSpaceUsageStatsResponse, PortalUsage
from app.routers import dependencies
from app.routers.portal_common import get_portal_service_dependency


def test_portal_usage_models_have_a_single_canonical_module() -> None:
    assert PortalUsage.__module__ == "app.models.portal_usage"
    assert PortalStorageSpaceUsageStatsResponse.__module__ == "app.models.portal_usage"


def test_portal_usage_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    usage = paths["/api/portal/usage"]["get"]
    assert usage["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalUsage"
    }

    storage_stats = paths["/api/portal/storage-spaces/{space_id}/usage-stats"]["get"]
    assert storage_stats["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceUsageStatsResponse"
    }


@pytest.mark.parametrize(
    ("message", "status_code"),
    [
        ("upstream timeout", 504),
        ("connection refused", 503),
        ("AccessDenied", 403),
        ("InvalidAccessKeyId", 403),
        ("SignatureDoesNotMatch", 403),
        ("upstream unavailable", 502),
    ],
)
def test_portal_usage_translates_upstream_failures_without_exposing_secrets(client, message, status_code):
    user = User(id=1, email="usage@example.test", role=UserRole.UI_USER.value)
    access = AccountAccess(
        account=S3Account(id=42, name="usage-account"),
        actor=user,
        membership=None,
        capabilities=AccountCapabilities(),
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )

    class FailedUsageService:
        def get_usage(self, actor, resolved_access):
            assert actor is user
            assert resolved_access is access
            raise RuntimeError(f"{message} secret_access_key=test-secret token=test-token")

    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_portal_account_access] = lambda: access
    app.dependency_overrides[get_portal_service_dependency] = FailedUsageService

    response = client.get("/api/portal/usage", params={"account_id": "42"})

    assert response.status_code == status_code
    assert response.json() == {
        "detail": f"{message} secret_access_key=<redacted> token=<redacted>",
    }


@pytest.mark.parametrize("account_id", ["conn-1", "s3u-1", "ceph-admin-1"])
@pytest.mark.parametrize(
    "path",
    ["/usage", "/usage-stats/latest", "/storage-spaces/space-1/usage-stats"],
)
def test_portal_usage_rejects_non_account_contexts_before_resolving_services(client, account_id, path):
    user = User(id=1, email="usage@example.test", role=UserRole.UI_USER.value)

    def unexpected_service():
        raise AssertionError("Rejected contexts must not resolve Portal services")

    app.dependency_overrides[dependencies.require_portal_enabled] = lambda: None
    app.dependency_overrides[dependencies.get_current_account_user] = lambda: user
    app.dependency_overrides[get_portal_service_dependency] = unexpected_service

    response = client.get(f"/api/portal{path}", params={"account_id": account_id})

    assert response.status_code == 403
    assert response.json() == {"detail": "S3 user context is not supported here"}
