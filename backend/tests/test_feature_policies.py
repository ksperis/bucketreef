# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

import pytest

from app.db import AppSetting, User
from app.db.enums import UserRole
from app.models.app_settings import AppSettings
from app.models.feature_policy import FeaturePolicy, resolve_feature_policy
from app.services.effective_access_service import EffectiveAccessService
from app.services.portal_service import PortalService
from app.services.feature_policy_service import manager_resource_states
from app.models.app_settings import PortalSettingsOverride
from app.services.portal.exceptions import PortalForbiddenError
from app.utils.app_settings_import import normalize_settings_import
from tests.s3_account_factory import make_s3_account


@pytest.mark.parametrize("policy,override,enabled,source", [
    ("disabled", True, False, "platform"),
    ("disabled", None, False, "platform"),
    ("targeted", None, False, "platform"),
    ("targeted", True, True, "resource"),
    ("default_on", None, True, "platform"),
    ("default_on", False, False, "resource"),
])
def test_policy_precedence(policy, override, enabled, source):
    state = resolve_feature_policy(FeaturePolicy(policy), override)
    assert state.enabled is enabled
    assert state.source == source
    assert state.blocked_reason == ("platform_disabled" if policy == "disabled" else "resource_disabled" if override is False else "activation_required" if policy == "targeted" and override is None else None)


def test_import_preserves_availability_and_portal_exceptions():
    original = {"general": {"bucket_compare_enabled": True, "bucket_purge_enabled": False},
                "portal": {"allow_portal_user_external_sharing": False}}
    converted = normalize_settings_import(original)
    settings = AppSettings.model_validate(converted)
    assert settings.manager.feature_policies.bucket_compare == FeaturePolicy.TARGETED
    assert settings.manager.feature_policies.bucket_purge == FeaturePolicy.DISABLED
    assert settings.portal.feature_policies.user_external_sharing == FeaturePolicy.TARGETED
    assert normalize_settings_import(converted) == converted
    assert original["general"]["bucket_compare_enabled"] is True


def test_platform_tool_grant_uses_existing_role_boundary_and_provenance(db_session):
    settings = AppSettings()
    settings.manager.feature_policies.bucket_compare = FeaturePolicy.DEFAULT_ON
    row = AppSetting(key="default", payload_json=settings.model_dump_json())
    db_session.add(row)
    user = User(email="policies@example.test", full_name="Policies", hashed_password="x", role=UserRole.UI_USER.value)
    db_session.add(user)
    db_session.commit()
    access = EffectiveAccessService(db_session).resolve_user(user)
    assert access.manager_tool_access.bucket_compare is True
    assert [source.kind for source in access.feature_sources["manager_bucket_compare"]] == ["platform"]
    assert access.account_links == []
    user.role = UserRole.UI_NONE.value
    db_session.commit()
    assert EffectiveAccessService(db_session).resolve_user(user).manager_tool_access.bucket_compare is False
    user.role = UserRole.UI_USER.value
    user.can_access_manager_bucket_compare = True
    settings.manager.feature_policies.bucket_compare = FeaturePolicy.DISABLED
    row.payload_json = settings.model_dump_json()
    db_session.commit()
    assert EffectiveAccessService(db_session).resolve_user(user).manager_tool_access.bucket_compare is False


def test_portal_lock_masks_preserved_override_and_rejects_new_activation(db_session, monkeypatch):
    settings = AppSettings()
    settings.portal.feature_policies.user_external_sharing = FeaturePolicy.DISABLED
    monkeypatch.setattr("app.services.portal.settings.load_app_settings", lambda: settings)
    account = make_s3_account(db_session, name="Policies", portal_settings_override=json.dumps({"allow_portal_user_external_sharing": True}))
    db_session.add(account)
    db_session.commit()
    service = PortalService(db_session)
    state = service.get_portal_account_settings(account)
    assert state.admin_override.allow_portal_user_external_sharing is True
    assert state.effective.allow_portal_user_external_sharing is False
    assert state.feature_states["allow_portal_user_external_sharing"].blocked_reason == "platform_disabled"
    account.portal_settings_override = None
    db_session.commit()
    with pytest.raises(PortalForbiddenError, match="disabled by the platform"):
        service.update_admin_portal_settings_override(account, PortalSettingsOverride(allow_portal_user_external_sharing=True))


def test_account_override_explicit_null_restores_inheritance(client, db_session):
    account = make_s3_account(db_session, name="Inherited", allow_access_key_metadata=False)
    db_session.add(account)
    db_session.commit()
    response = client.put(f"/api/admin/accounts/{account.id}", json={"allow_access_key_metadata": None})
    assert response.status_code == 200, response.text
    assert response.json()["allow_access_key_metadata"] is None

    db_session.refresh(account)
    assert account.allow_access_key_metadata is None
    response = client.put(f"/api/admin/accounts/{account.id}", json={"email": "changed@example.test"})
    assert response.status_code == 200, response.text
    assert response.json()["allow_access_key_metadata"] is None


def test_admin_portal_prohibition_returns_forbidden_before_logging_reconciliation(client, db_session, monkeypatch):
    settings = AppSettings()
    settings.portal.feature_policies.user_external_sharing = FeaturePolicy.DISABLED
    monkeypatch.setattr("app.services.portal.settings.load_app_settings", lambda: settings)
    account = make_s3_account(db_session, name="Locked project")
    db_session.add(account)
    db_session.commit()
    response = client.put(f"/api/admin/accounts/{account.id}/portal-settings", json={"allow_portal_user_external_sharing": True})
    assert response.status_code == 403, response.text
    assert "disabled by the platform" in response.json()["detail"]
    db_session.refresh(account)
    assert account.portal_settings_override is None


def test_account_provisioning_state_uses_ui_grant_without_inventing_resource_opt_in(db_session):
    settings = AppSettings()
    settings.manager.feature_policies.managed_private_connection_provisioning = FeaturePolicy.TARGETED
    account = make_s3_account(db_session, name="Account workflow")
    states = manager_resource_states(settings.manager.feature_policies, account, {
        "bucket_quota_management": False, "ceph_s3_user_keys": False, "access_key_metadata": False,
        "access_key_expiration": False, "managed_private_connection_provisioning": True,
    }, provisioning_source="group")
    state = states["managed_private_connection_provisioning"]
    assert state.enabled is True
    assert state.source == "group"
    assert state.blocked_reason is None
