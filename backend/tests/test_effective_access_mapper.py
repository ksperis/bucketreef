# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.access_context import EffectiveAccountGroupRole, EffectiveAccountLink
from app.models.user import ManagerToolAccess
from app.services.effective_access_service import EffectiveAccessSource, ResolvedUserAccess
from app.services.mappers.effective_access import effective_user_access_from_resolved


def test_effective_access_mapper_preserves_group_provenance_and_name_fallbacks() -> None:
    group_source = EffectiveAccountGroupRole(
        group_id=4,
        group_name="Operators",
        manager_role="account_administrator",
        determines_effective_manager_role=True,
        allow_manager_browser_data_access=True,
    )
    resolved = ResolvedUserAccess(
        group_ids=[4],
        group_details=[],
        account_links=[
            EffectiveAccountLink(
                account_id=42,
                manager_role="account_administrator",
                portal_role="portal_user",
                direct_portal_role="portal_user",
                direct_determines_effective_portal_role=True,
                group_sources=(group_source,),
            )
        ],
        s3_user_ids=[7, 8],
        manager_browser_s3_user_ids=[7],
        s3_connection_ids=[11, 12],
        can_access_ceph_admin=True,
        can_access_storage_ops=True,
        can_create_manual_private_connections=False,
        can_provision_managed_private_connections=True,
        allow_multisite_endpoint_switching=False,
        has_owned_private_connections=True,
        manager_tool_access=ManagerToolAccess(
            bucket_compare=True,
            bucket_migration=True,
        ),
        browser_advanced_features_enabled=True,
        feature_sources={
            "managed_private_connection_provision": (
                EffectiveAccessSource(kind="platform"),
                EffectiveAccessSource(kind="group", group_id=4, group_name="Operators"),
            ),
            "manager_bucket_compare": (EffectiveAccessSource(kind="direct"),),
            "manager_bucket_migration": (
                EffectiveAccessSource(kind="group", group_id=4, group_name="Operators"),
            ),
        },
    )

    mapped = effective_user_access_from_resolved(
        resolved,
        s3_user_names={7: "billing", 8: ""},
        shared_connection_names={11: "shared", 12: ""},
    )

    assert mapped.group_can_provision_managed_private_connections is True
    assert mapped.group_manager_tool_access == ManagerToolAccess(bucket_migration=True)
    assert mapped.account_links[0].model_dump() == {
        "manager_role": "account_administrator",
        "portal_role": "portal_user",
        "allow_manager_browser_data_access": True,
        "account_id": 42,
        "provenance": {
            "direct_manager_role": None,
            "direct_portal_role": "portal_user",
            "direct_determines_effective_manager_role": False,
            "direct_determines_effective_portal_role": True,
            "direct_allow_manager_browser_data_access": False,
            "groups": [
                {
                    "group_id": 4,
                    "group_name": "Operators",
                    "manager_role": "account_administrator",
                    "portal_role": None,
                    "determines_effective_manager_role": True,
                    "determines_effective_portal_role": False,
                    "allow_manager_browser_data_access": True,
                }
            ],
        },
    }
    assert [item.model_dump() for item in mapped.s3_user_details] == [
        {"id": 7, "name": "billing"},
        {"id": 8, "name": "S3 User #8"},
    ]
    assert [item.model_dump() for item in mapped.s3_connection_details] == [
        {"id": 11, "name": "shared"},
        {"id": 12, "name": "Connection #12"},
    ]
