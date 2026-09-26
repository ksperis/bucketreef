# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json

from app.db import (
    ManagerAccountRole,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserRole,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.services.access_audit_service import AccessAuditFilters, AccessAuditService
from tests.s3_account_factory import make_s3_account


def _seed_access_graph(db_session):
    user = User(
        email="alice@example.test",
        full_name="Alice Example",
        hashed_password="x",
        is_active=False,
        role=UserRole.UI_USER.value,
        can_access_ceph_admin=True,
        can_access_storage_ops=True,
        can_access_manager_bucket_compare=True,
    )
    group = UiGroup(
        name="Storage Operators",
        can_access_storage_ops=True,
        can_access_manager_bucket_migration=True,
        browser_advanced_features_enabled=True,
    )
    db_session.add_all([user, group])
    db_session.flush()
    db_session.add(UserUiGroup(user_id=user.id, group_id=group.id))

    account = make_s3_account(db_session, name="Research")
    db_session.add(account)
    db_session.flush()
    rgw_user = S3User(
        name="research-user",
        rgw_user_uid="research-user",
        rgw_access_key="rgw-ak",
        rgw_secret_key="rgw-sk",
        storage_endpoint_id=account.storage_endpoint_id,
    )
    shared = S3Connection(
        created_by_user_id=user.id,
        name="shared-main",
        is_shared=True,
        access_manager=True,
        access_key_id="shared-ak",
        secret_access_key="shared-sk",
        custom_endpoint_config=json.dumps({
            "endpoint_url": "https://s3.example.test",
            "region": None,
            "provider": None,
            "force_path_style": False,
            "verify_tls": True,
        }),
    )
    private = S3Connection(
        created_by_user_id=user.id,
        name="private-main",
        is_shared=False,
        access_manager=True,
        access_key_id="private-ak",
        secret_access_key="private-sk",
        custom_endpoint_config=json.dumps({
            "endpoint_url": "https://private.example.test",
            "region": None,
            "provider": None,
            "force_path_style": False,
            "verify_tls": True,
        }),
    )
    db_session.add_all([rgw_user, shared, private])
    db_session.flush()

    db_session.add_all([
        UserS3Account(
            user_id=user.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role="portal_user",
            allow_manager_browser_data_access=False,
        ),
        UiGroupS3Account(
            group_id=group.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role="portal_manager",
            allow_manager_browser_data_access=True,
        ),
        UserS3User(user_id=user.id, s3_user_id=rgw_user.id, allow_manager_browser_data_access=False),
        UiGroupS3User(group_id=group.id, s3_user_id=rgw_user.id, allow_manager_browser_data_access=True),
        UserS3Connection(user_id=user.id, s3_connection_id=shared.id),
        UiGroupS3Connection(group_id=group.id, s3_connection_id=shared.id),
        # Private connection identifiers must never enter the Admin audit inventory.
        UiGroupS3Connection(group_id=group.id, s3_connection_id=private.id),
    ])
    db_session.commit()
    return user, group, account, rgw_user, shared, private


def _row(rows, scope):
    return next(row for row in rows if row.scope == scope)


def _right(row, code):
    return next(right for right in row.rights if right.code == code)


def test_access_audit_aggregates_direct_and_group_rights_with_provenance(db_session):
    user, group, account, rgw_user, shared, private = _seed_access_graph(db_session)

    rows = AccessAuditService(db_session).list_rows(AccessAuditFilters(user_id=user.id))

    assert {row.scope for row in rows} == {"platform", "rgw_account", "rgw_user", "s3_connection"}
    assert all(row.principal.is_active is False for row in rows)

    platform = _row(rows, "platform")
    platform_codes = {right.code for right in platform.rights}
    assert "ceph_admin" not in platform_codes  # UI User role masks the persisted direct flag.
    assert {"storage_ops", "manager_bucket_compare", "manager_bucket_migration", "browser_advanced_features"} <= platform_codes
    storage_sources = _right(platform, "storage_ops").sources
    assert [(source.kind, source.group_name) for source in storage_sources] == [
        ("direct", None),
        ("group", group.name),
    ]

    account_row = _row(rows, "rgw_account")
    assert account_row.target.id == account.id
    assert account_row.target.identifier == account.rgw_account_id
    assert [source.kind for source in _right(account_row, "account_administrator").sources] == ["direct", "group"]
    assert [(source.kind, source.group_name) for source in _right(account_row, "portal_manager").sources] == [
        ("group", group.name)
    ]
    assert [(source.kind, source.group_name) for source in _right(account_row, "manager_browser_data_access").sources] == [
        ("group", group.name)
    ]

    rgw_row = _row(rows, "rgw_user")
    assert rgw_row.target.id == rgw_user.id
    assert [source.kind for source in _right(rgw_row, "rgw_user_access").sources] == ["direct", "group"]
    assert [(source.kind, source.group_name) for source in _right(rgw_row, "manager_browser_data_access").sources] == [
        ("group", group.name)
    ]

    connection_row = _row(rows, "s3_connection")
    assert connection_row.target.id == shared.id
    assert [source.kind for source in _right(connection_row, "shared_connection_access").sources] == ["direct", "group"]
    assert all(row.target.id != private.id for row in rows)


def test_access_audit_filters_and_csv_share_the_same_inventory(db_session):
    user, group, account, _, _, _ = _seed_access_graph(db_session)
    service = AccessAuditService(db_session)
    filters = AccessAuditFilters(
        user_id=user.id,
        scope="rgw_account",
        target_id=account.id,
        right="portal_manager",
        source="group",
    )

    rows = service.list_rows(filters)
    assert len(rows) == 1
    assert rows[0].target.id == account.id
    assert any(right.code == "portal_manager" for right in rows[0].rights)

    filename, payload = service.export_csv(filters)
    assert filename == "access-audit.csv"
    assert "alice@example.test" in payload
    assert "portal manager" in payload.lower()
    assert group.name in payload
    assert "false" in payload


def test_access_audit_route_supports_resource_filters_and_export(client, db_session):
    user, _, _, rgw_user, _, _ = _seed_access_graph(db_session)

    response = client.get(
        "/api/admin/access-audit",
        params={"scope": "rgw_user", "target_id": rgw_user.id, "page_size": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["principal"]["id"] == user.id
    assert body["items"][0]["target"]["id"] == rgw_user.id

    exported = client.get(
        "/api/admin/access-audit/export.csv",
        params={"scope": "rgw_user", "target_id": rgw_user.id},
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert "attachment" in exported.headers["content-disposition"]
    assert "research-user" in exported.text
