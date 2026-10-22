# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.services.portal_service import PortalService


def test_rgw_requester_identity_uses_nested_user_aliases(db_session):
    identity = PortalService(db_session)._portal_server_access_identity_from_rgw_payload(
        {
            "account": "RGW00000000000000001",
            "user": {
                "user_id": "tenant-a$user-a",
                "email": "user-a@example.test",
            },
        }
    )

    assert identity is not None
    assert identity.kind == "rgw_user"
    assert identity.label == "user-a@example.test"
    assert identity.detail == "RGW user tenant-a$user-a · account RGW00000000000000001"
    assert identity.iam_username == "tenant-a$user-a"
    assert identity.email == "user-a@example.test"
    assert identity.resolved is True


def test_rgw_requester_identity_supports_account_only_payload(db_session):
    identity = PortalService(db_session)._portal_server_access_identity_from_rgw_payload(
        {"account_id": "RGW00000000000000002"}
    )

    assert identity is not None
    assert identity.kind == "rgw_account"
    assert identity.label == "RGW00000000000000002"
    assert identity.detail == "RGW account"
    assert identity.resolved is True


def test_rgw_requester_identity_ignores_not_found_payload(db_session):
    assert (
        PortalService(db_session)._portal_server_access_identity_from_rgw_payload(
            {"not_found": True, "user_id": "ignored"}
        )
        is None
    )
