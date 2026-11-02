# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.models.ui_group import UiGroupUpdate
from app.models.user import UserCreate, UserUpdate


def test_user_create_rejects_null_openstack_associations() -> None:
    with pytest.raises(ValidationError):
        UserCreate.model_validate(
            {
                "email": "create-contract@example.test",
                "password": "valid-test-password",
                "role": "ui_user",
                "can_access_ceph_admin": False,
                "can_access_storage_ops": False,
                "can_create_manual_private_connections": False,
                "can_provision_managed_private_connections": False,
                "allow_multisite_endpoint_switching": False,
                "manager_tool_access": {},
                "browser_advanced_features_enabled": False,
                "openstack_cloud_ids": None,
            }
        )


@pytest.mark.parametrize(
    "field",
    [
        "email",
        "avatar_preference",
        "quota_alerts_enabled",
        "quota_alerts_global_watch",
        "password",
        "role",
        "is_active",
        "can_access_ceph_admin",
        "can_access_storage_ops",
        "can_create_manual_private_connections",
        "can_provision_managed_private_connections",
        "allow_multisite_endpoint_switching",
        "manager_tool_access",
        "browser_advanced_features_enabled",
        "account_links",
        "s3_user_links",
        "s3_connection_ids",
        "group_ids",
        "openstack_cloud_ids",
    ],
)
def test_user_update_rejects_null_for_concrete_mutations(field: str) -> None:
    with pytest.raises(ValidationError, match=rf"{field} cannot be null"):
        UserUpdate.model_validate({field: None})


@pytest.mark.parametrize("field", ["full_name", "ui_language"])
def test_user_update_preserves_explicit_nullable_resets(field: str) -> None:
    payload = UserUpdate.model_validate({field: None})

    assert field in payload.model_fields_set
    assert getattr(payload, field) is None


@pytest.mark.parametrize(
    "field",
    [
        "name",
        "avatar_source",
        "can_access_ceph_admin",
        "can_access_storage_ops",
        "can_create_manual_private_connections",
        "can_provision_managed_private_connections",
        "allow_multisite_endpoint_switching",
        "manager_tool_access",
        "browser_advanced_features_enabled",
        "user_ids",
        "account_links",
        "s3_user_links",
        "s3_connection_ids",
        "openstack_cloud_ids",
    ],
)
def test_group_update_rejects_null_for_concrete_mutations(field: str) -> None:
    with pytest.raises(ValidationError, match=rf"{field} cannot be null"):
        UiGroupUpdate.model_validate({field: None})


@pytest.mark.parametrize("field", ["description", "avatar_icon"])
def test_group_update_preserves_explicit_nullable_resets(field: str) -> None:
    payload = UiGroupUpdate.model_validate({field: None})

    assert field in payload.model_fields_set
    assert getattr(payload, field) is None
