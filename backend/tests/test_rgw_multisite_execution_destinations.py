# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.db import S3Connection, S3User, StorageEndpoint, User, UserS3Account, UserS3User
from app.core.domain_enums import ManagerAccountRole, UserRole
from app.models.app_settings import AppSettings
from app.routers.dependencies_internal.execution_context import resolve_s3_execution_context
from app.services.app_settings_service import save_app_settings_for_db
from app.services.execution_context_catalog_service import ExecutionContextCatalogService
from app.services.rgw_multisite_endpoints import (
    list_compatible_rgw_execution_endpoints,
    rgw_multisite_endpoints_compatible,
)
from app.utils.s3_endpoint import resolve_s3_client_options
from tests.s3_account_factory import make_s3_account


def _endpoint(
    name: str,
    *,
    provider: str = "ceph",
    realm_id: str | None = "realm-a",
    zonegroup_id: str | None = "zonegroup-a",
    zone_id: str | None = None,
    region: str | None = None,
    force_path_style: bool = False,
    verify_tls: bool = True,
) -> StorageEndpoint:
    return StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider=provider,
        realm_id=realm_id,
        zonegroup_id=zonegroup_id,
        zone_id=zone_id,
        region=region,
        force_path_style=force_path_style,
        verify_tls=verify_tls,
    )


def _connection(
    user: User,
    endpoint: StorageEndpoint,
    *,
    name: str,
    session_token: str | None = None,
) -> S3Connection:
    return S3Connection(
        created_by_user_id=user.id,
        name=name,
        is_shared=False,
        is_active=True,
        access_manager=True,
        access_browser=True,
        storage_endpoint=endpoint,
        storage_endpoint_id=endpoint.id,
        access_key_id=f"AK-{name}",
        secret_access_key=f"SK-{name}",
        session_token=session_token,
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


def test_connection_destination_override_preserves_credentials_and_uses_destination_options(db_session):
    origin = _endpoint(
        "connection-origin",
        zone_id="zone-a",
        region="region-a",
        force_path_style=False,
        verify_tls=True,
    )
    destination = _endpoint(
        "connection-destination",
        zone_id="zone-b",
        region="region-b",
        force_path_style=True,
        verify_tls=False,
    )
    db_session.add_all([origin, destination])
    db_session.flush()
    user = User(
        email="multisite-connection@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=True,
    )
    db_session.add(user)
    db_session.flush()
    connection = _connection(user, origin, name="browser-connection")
    db_session.add(connection)
    db_session.commit()

    context = resolve_s3_execution_context(
        _request("/api/browser/buckets/search", workspace="browser"),
        f"conn-{connection.id}",
        user,
        db_session,
        execution_endpoint_id=destination.id,
    )

    assert context.storage_endpoint_id == destination.id
    assert context.storage_endpoint is destination
    assert context.source_connection is connection
    assert context.effective_rgw_credentials() == ("AK-browser-connection", "SK-browser-connection")
    assert resolve_s3_client_options(context) == (
        destination.endpoint_url,
        "region-b",
        True,
        False,
    )


def test_temporary_connection_destination_override_is_rejected_in_full_and_metadata_contexts(db_session):
    origin = _endpoint("temporary-origin", zone_id="zone-a")
    destination = _endpoint("temporary-destination", zone_id="zone-b")
    db_session.add_all([origin, destination])
    db_session.flush()
    user = User(
        email="multisite-temporary@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=True,
    )
    db_session.add(user)
    db_session.flush()
    connection = _connection(
        user,
        origin,
        name="temporary-connection",
        session_token="temporary-token",
    )
    db_session.add(connection)
    db_session.commit()

    for metadata_only in (False, True):
        with pytest.raises(HTTPException) as denied:
            resolve_s3_execution_context(
                _request("/api/browser/direct-transfer-policy", workspace="browser"),
                f"conn-{connection.id}",
                user,
                db_session,
                execution_endpoint_id=destination.id,
                metadata_only=metadata_only,
            )
        assert denied.value.status_code == 403
        assert "temporary connection credentials" in denied.value.detail


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


def test_account_resource_grant_enables_catalogue_and_execution_without_principal_grant(db_session):
    origin = _endpoint("account-resource-origin", zone_id="zone-a")
    destination = _endpoint("account-resource-destination", zone_id="zone-b")
    db_session.add_all([origin, destination])
    db_session.flush()
    user = User(
        email="multisite-account-resource@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=False,
    )
    account = make_s3_account(
        db_session,
        name="multisite-resource-account",
        rgw_account_id="RGWMULTISITE0004",
        rgw_access_key="RESOURCE-AK",
        rgw_secret_key="RESOURCE-SK",
        storage_endpoint=origin,
        storage_endpoint_id=origin.id,
        allow_multisite_endpoint_switching=True,
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

    contexts = ExecutionContextCatalogService(db_session).list_contexts(
        user,
        workspace="manager",
    )
    context = next(item for item in contexts if item.id == str(account.id))
    assert context.destination_switching_allowed is True
    assert {item.endpoint_id for item in context.execution_destinations} == {origin.id, destination.id}

    resolved = resolve_s3_execution_context(
        _request(),
        str(account.id),
        user,
        db_session,
        execution_endpoint_id=destination.id,
    )
    assert resolved.storage_endpoint_id == destination.id


def test_disabled_account_resource_policy_masks_override_but_not_principal_grant(db_session):
    origin = _endpoint("account-disabled-origin", zone_id="zone-a")
    destination = _endpoint("account-disabled-destination", zone_id="zone-b")
    db_session.add_all([origin, destination])
    db_session.flush()
    user = User(
        email="multisite-account-disabled@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=False,
    )
    account = make_s3_account(
        db_session,
        name="multisite-disabled-account",
        rgw_account_id="RGWMULTISITE0005",
        rgw_access_key="DISABLED-AK",
        rgw_secret_key="DISABLED-SK",
        storage_endpoint=origin,
        storage_endpoint_id=origin.id,
        allow_multisite_endpoint_switching=True,
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
    settings = AppSettings()
    settings.manager.feature_policies.rgw_multisite_endpoint_switching = "disabled"
    save_app_settings_for_db(db_session, settings)

    with pytest.raises(HTTPException) as denied:
        resolve_s3_execution_context(
            _request(),
            str(account.id),
            user,
            db_session,
            execution_endpoint_id=destination.id,
        )
    assert denied.value.status_code == 403

    user.allow_multisite_endpoint_switching = True
    db_session.commit()
    resolved = resolve_s3_execution_context(
        _request(),
        str(account.id),
        user,
        db_session,
        execution_endpoint_id=destination.id,
    )
    assert resolved.storage_endpoint_id == destination.id


def test_s3_user_resource_grant_enables_execution_without_principal_grant(db_session):
    origin = _endpoint("user-resource-origin", zone_id="zone-a")
    destination = _endpoint("user-resource-destination", zone_id="zone-b")
    db_session.add_all([origin, destination])
    db_session.flush()
    user = User(
        email="multisite-s3-user-resource@example.test",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
        allow_multisite_endpoint_switching=False,
    )
    s3_user = S3User(
        name="multisite-resource-user",
        rgw_user_uid="multisite-resource-user",
        rgw_tenant="",
        rgw_access_key="USER-AK",
        rgw_secret_key="USER-SK",
        storage_endpoint=origin,
        storage_endpoint_id=origin.id,
        allow_multisite_endpoint_switching=True,
    )
    db_session.add_all([user, s3_user])
    db_session.flush()
    db_session.add(
        UserS3User(
            user_id=user.id,
            s3_user_id=s3_user.id,
            allow_manager_browser_data_access=True,
        )
    )
    db_session.commit()

    contexts = ExecutionContextCatalogService(db_session).list_contexts(
        user,
        workspace="manager",
    )
    context = next(item for item in contexts if item.id == f"s3u-{s3_user.id}")
    assert context.destination_switching_allowed is True

    resolved = resolve_s3_execution_context(
        _request(),
        f"s3u-{s3_user.id}",
        user,
        db_session,
        execution_endpoint_id=destination.id,
    )
    assert resolved.storage_endpoint_id == destination.id
