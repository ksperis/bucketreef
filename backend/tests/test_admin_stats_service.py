# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.services.admin_stats_service import AdminStatsService


def test_platform_summary_reports_global_counts(db_session):
    ceph_one = StorageEndpoint(
        name="ceph-one",
        endpoint_url="https://ceph-one.test",
        provider="ceph",
    )
    ceph_two = StorageEndpoint(
        name="ceph-two",
        endpoint_url="https://ceph-two.test",
        provider="ceph",
    )
    other = StorageEndpoint(
        name="other",
        endpoint_url="https://other.test",
        provider=StorageProvider.OTHER.value,
    )
    admin = User(email="admin@example.test", role=UserRole.UI_ADMIN.value)
    superadmin = User(email="superadmin@example.test", role=UserRole.UI_SUPERADMIN.value)
    manager = User(email="manager@example.test", role=UserRole.UI_USER.value)
    none_user = User(email="none@example.test", role=UserRole.UI_NONE.value)
    account_one = S3Account(
        name="account-one",
        rgw_account_id="account-one",
        rgw_user_uid="account-one-root",
        storage_endpoint=ceph_one,
    )
    account_two = S3Account(
        name="account-two",
        rgw_account_id="account-two",
        rgw_user_uid="account-two-root",
        storage_endpoint=ceph_two,
    )
    s3_user_one = S3User(
        name="user-one",
        rgw_user_uid="user-one",
        rgw_access_key="ak-one",
        rgw_secret_key="sk-one",
        storage_endpoint=ceph_one,
    )
    s3_user_two = S3User(
        name="user-two",
        rgw_user_uid="user-two",
        rgw_access_key="ak-two",
        rgw_secret_key="sk-two",
        storage_endpoint=ceph_two,
    )
    db_session.add_all(
        [
            ceph_one,
            ceph_two,
            other,
            admin,
            superadmin,
            manager,
            none_user,
            account_one,
            account_two,
            s3_user_one,
            s3_user_two,
        ]
    )
    db_session.flush()
    db_session.add_all(
        [
            UserS3Account(
                user_id=manager.id,
                account_id=account_one.id,
                manager_role=None,
                portal_role="portal_user",
            ),
            UserS3Account(
                user_id=admin.id,
                account_id=account_two.id,
                manager_role="account_administrator",
                portal_role=None,
            ),
            UserS3User(user_id=manager.id, s3_user_id=s3_user_one.id),
            S3Connection(
                created_by_user_id=manager.id,
                name="shared",
                is_shared=True,
                access_key_id="shared-ak",
                secret_access_key="shared-sk",
                storage_endpoint_id=ceph_one.id,
            ),
            S3Connection(
                created_by_user_id=manager.id,
                name="private",
                is_shared=False,
                access_key_id="private-ak",
                secret_access_key="private-sk",
                storage_endpoint_id=ceph_two.id,
            ),
        ]
    )
    db_session.commit()

    summary = AdminStatsService(db_session).platform_summary()

    assert summary == {
        "total_accounts": 2,
        "total_users": 1,
        "total_admins": 2,
        "total_none_users": 1,
        "total_s3_users": 2,
        "assigned_accounts": 2,
        "unassigned_accounts": 0,
        "assigned_s3_users": 1,
        "unassigned_s3_users": 1,
        "total_endpoints": 3,
        "total_ceph_endpoints": 2,
        "total_other_endpoints": 1,
        "total_connections": 2,
        "total_shared_connections": 1,
        "total_private_connections": 1,
    }
