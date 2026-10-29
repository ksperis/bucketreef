# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import ManagerAccountRole, StorageEndpoint, User, UserRole, UserS3Account
from app.routers.dependencies_internal.execution_context import resolve_s3_execution_context
from app.services.rgw_multisite_endpoints import (
    list_compatible_rgw_execution_endpoints,
    rgw_multisite_endpoints_compatible,
)
from tests.s3_account_factory import make_s3_account


def _endpoint(
    name: str,
    *,
    provider: str = "ceph",
    realm_id: str | None = "realm-a",
    zonegroup_id: str | None = "zonegroup-a",
    zone_id: str | None = None,
) -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=provider,
        realm_id=realm_id,
        zonegroup_id=zonegroup_id,
        zone_id=zone_id,
    )


def _request(path: str = "/api/manager/buckets", *, workspace: str | None = None):
    headers = {"X-S3-Workspace": workspace} if workspace else {}
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers=headers,
        method="GET",
        query_params={},
    )


@pytest.mark.parametrize(
    ("destination", "expected"),
    [
        (_endpoint("same", zone_id="zone-b"), True),
        (_endpoint("other-realm", realm_id="realm-b"), False),
        (_endpoint("other-zonegroup", zonegroup_id="zonegroup-b"), False),
        (_endpoint("missing-realm", realm_id=None), False),
        (_endpoint("missing-zonegroup", zonegroup_id=None), False),
        (_endpoint("aws", provider="aws"), False),
    ],
)
def test_multisite_compatibility_requires_same_ceph_realm_and_zonegroup(destination, expected):
    origin = _endpoint("origin", zone_id="zone-a")

    assert rgw_multisite_endpoints_compatible(origin, destination) is expected


def test_compatible_destination_listing_filters_and_orders_endpoints(db_session):
    origin = _endpoint("zone-b", zone_id="zone-b")
    same = _endpoint("zone-a", zone_id="zone-a")
    other_zonegroup = _endpoint("zone-c", zonegroup_id="zonegroup-b")
    other_provider = _endpoint("zone-d", provider="aws")
    db_session.add_all([origin, same, other_zonegroup, other_provider])
    db_session.commit()

    destinations = list_compatible_rgw_execution_endpoints(db_session, origin)

    assert [item.id for item in destinations] == [same.id, origin.id]


def test_destination_override_preserves_account_identity_and_credentials(db_session):
    origin = _endpoint("origin", zone_id="zone-a")
    destination = _endpoint("destination", zone_id="zone-b")
    db_session.add_all([origin, destination])
    db_session.flush()
    user = User(
        email="multisite-switch@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=True,
    )
    account = make_s3_account(
        db_session,
        name="multisite-account",
        rgw_account_id="RGWMULTISITE0002",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
        storage_endpoint=origin,
        storage_endpoint_id=origin.id,
    )
    db_session.add_all([user, account])
    db_session.flush()
    link = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
        allow_manager_browser_data_access=True,
    )
    db_session.add(link)
    db_session.commit()

    context = resolve_s3_execution_context(
        _request(),
        str(account.id),
        user,
        db_session,
        execution_endpoint_id=destination.id,
    )

    assert context.storage_endpoint_id == destination.id
    assert context.storage_endpoint is destination
    assert context.context_id == str(account.id)
    assert context.source_account is account
    assert context.effective_rgw_credentials() == ("ROOT-AK", "ROOT-SK")

    browser_context = resolve_s3_execution_context(
        _request("/api/browser/buckets/search", workspace="manager-browser"),
        str(account.id),
        user,
        db_session,
        execution_endpoint_id=destination.id,
    )
    assert browser_context.storage_endpoint_id == destination.id
    assert browser_context.effective_rgw_credentials() == ("ROOT-AK", "ROOT-SK")


def test_destination_override_enforces_permission_topology_and_surface(db_session):
    origin = _endpoint("origin-policy", zone_id="zone-a")
    compatible = _endpoint("compatible-policy", zone_id="zone-b")
    incompatible = _endpoint("incompatible-policy", zonegroup_id="zonegroup-b")
    db_session.add_all([origin, compatible, incompatible])
    db_session.flush()
    user = User(
        email="multisite-policy@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=False,
    )
    account = make_s3_account(
        db_session,
        name="multisite-policy-account",
        rgw_account_id="RGWMULTISITE0003",
        rgw_access_key="POLICY-AK",
        rgw_secret_key="POLICY-SK",
        storage_endpoint=origin,
        storage_endpoint_id=origin.id,
    )
    db_session.add_all([user, account])
    db_session.flush()
    db_session.add(
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
            allow_manager_browser_data_access=True,
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as denied:
        resolve_s3_execution_context(
            _request(),
            str(account.id),
            user,
            db_session,
            execution_endpoint_id=compatible.id,
        )
    assert denied.value.status_code == 403

    user.allow_multisite_endpoint_switching = True
    db_session.commit()
    with pytest.raises(HTTPException) as wrong_topology:
        resolve_s3_execution_context(
            _request(),
            str(account.id),
            user,
            db_session,
            execution_endpoint_id=incompatible.id,
        )
    assert wrong_topology.value.status_code == 400

    with pytest.raises(HTTPException) as standard_browser:
        resolve_s3_execution_context(
            _request("/api/browser/buckets/search", workspace="browser"),
            str(account.id),
            user,
            db_session,
            execution_endpoint_id=compatible.id,
        )
    assert standard_browser.value.status_code == 403
