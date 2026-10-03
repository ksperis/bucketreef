# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from unittest.mock import Mock

from app.db import PortalStorageSpaceMetadata
from app.services.portal_service import PortalService
from tests.s3_account_factory import make_s3_account


def test_admin_bucket_info_uses_canonical_root_uid_without_unscoped_retry(db_session):
    account = make_s3_account(db_session, name="portal-admin-bucket-info")
    account.rgw_user_uid = "root-user"
    db_session.add(account)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            visibility="shared",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    admin = Mock()
    admin.get_bucket_info.return_value = {"bucket": "research-data"}

    result = service._admin_bucket_info(account, "research-data", admin=admin)

    assert result == {"bucket": "research-data"}
    admin.get_bucket_info.assert_called_once_with(
        "research-data",
        allow_not_found=True,
        uid="root-user",
    )


def test_admin_bucket_info_does_not_retry_unscoped_when_scoped_lookup_misses(db_session):
    account = make_s3_account(db_session, name="portal-admin-bucket-info-missing")
    account.rgw_user_uid = "root-user"
    db_session.add(account)
    db_session.flush()
    db_session.add(
        PortalStorageSpaceMetadata(
            account_id=account.id,
            bucket_name="research-data",
            visibility="shared",
        )
    )
    db_session.commit()
    service = PortalService(db_session)
    admin = Mock()
    admin.get_bucket_info.return_value = None

    result = service._admin_bucket_info(account, "research-data", admin=admin)

    assert result is None
    admin.get_bucket_info.assert_called_once_with(
        "research-data",
        allow_not_found=True,
        uid="root-user",
    )
