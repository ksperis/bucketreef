# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.ui_group import UiGroupAvatar, UiGroupOut
from app.models.user import (
    EffectiveAccountGroupSource,
    EffectiveAccountRoleProvenance,
    EffectiveUserAccess,
    UserAssociationDetail,
    UserAvatar,
    UserOut,
    UserSummary,
)


def test_user_avatar_requires_complete_canonical_payload() -> None:
    assert set(UserAvatar.model_json_schema()["required"]) == {
        "preference",
        "source",
        "url",
        "initials",
        "updated_at",
    }


def test_ui_group_avatar_requires_complete_canonical_payload() -> None:
    assert set(UiGroupAvatar.model_json_schema()["required"]) == {
        "source",
        "initials",
        "icon",
        "url",
        "updated_at",
    }


def test_user_association_detail_requires_complete_canonical_payload() -> None:
    schema = UserAssociationDetail.model_json_schema()

    assert set(schema["required"]) == {
        "id",
        "email",
        "full_name",
        "avatar",
    }
    assert "allow_manager_browser_data_access" not in schema["properties"]


def test_user_summary_requires_complete_canonical_payload() -> None:
    schema = UserSummary.model_json_schema()

    assert set(schema["required"]) == {
        "id",
        "email",
        "full_name",
        "avatar",
        "role",
    }
    assert "iam_username" not in schema["properties"]


def test_effective_account_group_source_requires_complete_canonical_payload() -> None:
    assert set(EffectiveAccountGroupSource.model_json_schema()["required"]) == {
        "group_id",
        "group_name",
        "manager_role",
        "portal_role",
        "determines_effective_manager_role",
        "determines_effective_portal_role",
        "allow_manager_browser_data_access",
    }


def test_effective_account_role_provenance_requires_complete_canonical_payload() -> None:
    assert set(EffectiveAccountRoleProvenance.model_json_schema()["required"]) == {
        "direct_manager_role",
        "direct_portal_role",
        "direct_determines_effective_manager_role",
        "direct_determines_effective_portal_role",
        "direct_allow_manager_browser_data_access",
        "groups",
    }


def test_effective_user_access_requires_complete_canonical_payload() -> None:
    assert set(EffectiveUserAccess.model_json_schema()["required"]) == {
        "can_access_ceph_admin",
        "can_access_storage_ops",
        "can_create_manual_private_connections",
        "can_provision_managed_private_connections",
        "group_can_provision_managed_private_connections",
        "has_owned_private_connections",
        "manager_tool_access",
        "group_manager_tool_access",
        "browser_advanced_features_enabled",
        "account_links",
        "s3_user_details",
        "s3_connection_details",
    }


def test_user_output_requires_complete_canonical_payload() -> None:
    assert set(UserOut.model_json_schema()["required"]) == {
        "id",
        "email",
        "full_name",
        "picture_url",
        "avatar",
        "has_local_password",
        "is_active",
        "is_admin",
        "role",
        "can_access_ceph_admin",
        "can_access_storage_ops",
        "can_create_manual_private_connections",
        "can_provision_managed_private_connections",
        "manager_tool_access",
        "browser_advanced_features_enabled",
        "ui_language",
        "quota_alerts_enabled",
        "quota_alerts_global_watch",
        "ui_preferences",
        "account_links",
        "group_details",
        "s3_user_links",
        "s3_user_details",
        "s3_connection_details",
        "openstack_cloud_details",
        "effective_access",
        "last_login_at",
    }


def test_ui_group_output_requires_complete_canonical_payload() -> None:
    assert set(UiGroupOut.model_json_schema()["required"]) == {
        "id",
        "name",
        "system_key",
        "description",
        "avatar",
        "can_access_ceph_admin",
        "can_access_storage_ops",
        "can_create_manual_private_connections",
        "can_provision_managed_private_connections",
        "manager_tool_access",
        "browser_advanced_features_enabled",
        "user_details",
        "account_details",
        "account_links",
        "s3_user_links",
        "s3_user_details",
        "s3_connection_details",
        "openstack_cloud_details",
        "created_at",
        "updated_at",
    }
