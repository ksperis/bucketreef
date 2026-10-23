# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json

import pytest

from app.db import AppSetting, S3Connection, S3User, User
from app.db.enums import UserRole
from app.models.app_settings import AppSettings
from app.models.feature_policy import FeaturePolicy, resolve_feature_policy
from app.services.effective_access_service import EffectiveAccessService
from app.services.portal_service import PortalService
from app.services.feature_policy_service import (
    apply_resource_feature_overrides,
    bucket_usage_stats_collection_state,
    bucket_usage_stats_state,
    manager_resource_states,
    manager_rgw_usage_metrics_state,
)
from app.models.s3_account import S3AccountUpdate
from app.models.s3_user import S3UserUpdate
from app.models.app_settings import PortalSettingsOverride
from app.services.portal.exceptions import PortalForbiddenError
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


def test_cost_estimation_policies_default_to_targeted():
    settings = AppSettings()

    assert settings.manager.feature_policies.cost_estimation == FeaturePolicy.TARGETED
    assert settings.portal.feature_policies.cost_estimation == FeaturePolicy.TARGETED


def test_cost_estimation_targeted_overrides_resolve_for_manager_and_portal(db_session, monkeypatch):
    settings = AppSettings()
    account = make_s3_account(
        db_session,
        name="Cost opt in",
        allow_cost_estimation=True,
        portal_settings_override=json.dumps({"cost_estimation_enabled": True}),
    )
    db_session.add(account)
    db_session.commit()

    manager_state = manager_resource_states(
        settings.manager.feature_policies,
        account,
        _manager_availability(),
    )["cost_estimation"]
    assert manager_state.enabled is True
    assert manager_state.source == "resource"

    monkeypatch.setattr("app.services.portal.settings.load_app_settings", lambda: settings)
    portal_settings = PortalService(db_session).get_effective_portal_settings(account)
    assert portal_settings.cost_estimation_enabled is True


@pytest.mark.parametrize(
    "policy,override,enabled,source",
    [
        (FeaturePolicy.DEFAULT_ON, None, True, "platform"),
        (FeaturePolicy.DEFAULT_ON, False, False, "resource"),
        (FeaturePolicy.TARGETED, None, False, "platform"),
        (FeaturePolicy.TARGETED, True, True, "resource"),
        (FeaturePolicy.DISABLED, True, False, "platform"),
    ],
)
def test_project_usage_capabilities_share_account_override_precedence(
    db_session, policy, override, enabled, source,
):
    settings = AppSettings()
    settings.manager.feature_policies.rgw_usage_metrics = policy
    settings.general.project_feature_policies.bucket_usage_stats = policy
    settings.general.project_collection_policies.bucket_usage_stats = policy
    account = make_s3_account(
        db_session,
        name=f"Usage policies {policy.value} {override}",
        allow_rgw_usage_metrics=override,
        allow_bucket_usage_stats=override,
        allow_bucket_usage_stats_collection=override,
    )

    metrics = manager_rgw_usage_metrics_state(settings.manager.feature_policies, account)
    composition = bucket_usage_stats_state(settings.general.project_feature_policies, account)
    collection = bucket_usage_stats_collection_state(settings.general.project_collection_policies, account)

    assert metrics.enabled is enabled
    assert metrics.source == source
    assert composition.enabled is enabled
    assert composition.source == source
    assert collection.enabled is enabled
    assert collection.source == source


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


def test_resource_feature_override_application_preserves_patch_semantics(db_session):
    account = make_s3_account(
        db_session,
        name="Policy patch",
        allow_access_key_metadata=False,
        allow_rgw_usage_metrics=True,
        allow_cost_estimation=False,
    )
    account_payload = S3AccountUpdate(
        allow_access_key_metadata=None,
        allow_bucket_usage_stats=False,
        allow_cost_estimation=True,
    )
    apply_resource_feature_overrides(account_payload, account)

    assert account.allow_access_key_metadata is None
    assert account.allow_bucket_usage_stats is False
    assert account.allow_rgw_usage_metrics is True
    assert account.allow_cost_estimation is True

    s3_user = S3User(
        name="Policy user",
        rgw_user_uid="policy-user",
        storage_endpoint_id=account.storage_endpoint_id,
        allow_access_key_expiration=True,
        allow_activity_history=False,
        allow_rgw_usage_metrics=False,
        allow_cost_estimation=False,
        allow_bucket_usage_stats=False,
        allow_bucket_usage_stats_collection=False,
    )
    user_payload = S3UserUpdate(
        allow_activity_history=None,
        allow_rgw_usage_metrics=True,
        allow_cost_estimation=True,
        allow_bucket_usage_stats=True,
        allow_bucket_usage_stats_collection=True,
    )
    apply_resource_feature_overrides(user_payload, s3_user)

    assert s3_user.allow_activity_history is None
    assert s3_user.allow_access_key_expiration is True
    assert s3_user.allow_rgw_usage_metrics is True
    assert s3_user.allow_cost_estimation is True
    assert s3_user.allow_bucket_usage_stats is True
    assert s3_user.allow_bucket_usage_stats_collection is True


@pytest.mark.parametrize(
    "policy,override,enabled,source",
    [
        (FeaturePolicy.DEFAULT_ON, None, True, "platform"),
        (FeaturePolicy.DEFAULT_ON, False, False, "resource"),
        (FeaturePolicy.TARGETED, None, False, "platform"),
        (FeaturePolicy.TARGETED, True, True, "resource"),
        (FeaturePolicy.DISABLED, True, False, "platform"),
    ],
)
def test_project_usage_capabilities_support_s3_user_overrides(policy, override, enabled, source):
    settings = AppSettings()
    settings.general.project_feature_policies.bucket_usage_stats = policy
    settings.general.project_collection_policies.bucket_usage_stats = policy
    s3_user = S3User(
        name="Composition policy user",
        rgw_user_uid="composition-policy-user",
        storage_endpoint_id=1,
        allow_bucket_usage_stats=override,
        allow_bucket_usage_stats_collection=override,
    )

    composition = bucket_usage_stats_state(settings.general.project_feature_policies, s3_user)
    collection = bucket_usage_stats_collection_state(settings.general.project_collection_policies, s3_user)

    assert composition.enabled is enabled
    assert composition.source == source
    assert collection.enabled is enabled
    assert collection.source == source


@pytest.mark.parametrize(
    "policy,override,enabled,source",
    [
        (FeaturePolicy.DEFAULT_ON, None, True, "platform"),
        (FeaturePolicy.DEFAULT_ON, False, False, "resource"),
        (FeaturePolicy.TARGETED, None, False, "platform"),
        (FeaturePolicy.TARGETED, True, True, "resource"),
        (FeaturePolicy.DISABLED, True, False, "platform"),
    ],
)
def test_rgw_usage_metrics_policy_supports_s3_user_overrides(policy, override, enabled, source):
    settings = AppSettings()
    settings.manager.feature_policies.rgw_usage_metrics = policy
    s3_user = S3User(
        name="Metrics policy user",
        rgw_user_uid="metrics-policy-user",
        storage_endpoint_id=1,
        allow_rgw_usage_metrics=override,
    )

    state = manager_rgw_usage_metrics_state(settings.manager.feature_policies, s3_user)

    assert state.enabled is enabled
    assert state.source == source


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
        "access_key_expiration": False, "cost_estimation": True,
        "managed_private_connection_provisioning": True,
    }, provisioning_source="group")
    state = states["managed_private_connection_provisioning"]
    assert state.enabled is True
    assert state.source == "group"
    assert state.blocked_reason is None


def _manager_availability() -> dict[str, bool]:
    return {
        "bucket_quota_management": True,
        "ceph_s3_user_keys": True,
        "access_key_metadata": True,
        "access_key_expiration": True,
        "cost_estimation": True,
        "managed_private_connection_provisioning": True,
    }


@pytest.mark.parametrize(
    "policy,override,enabled,source,blocked_reason",
    [
        (FeaturePolicy.DEFAULT_ON, None, True, "platform", None),
        (FeaturePolicy.DEFAULT_ON, False, False, "resource", "resource_disabled"),
        (FeaturePolicy.TARGETED, True, True, "resource", None),
        (FeaturePolicy.DISABLED, True, False, "platform", "platform_disabled"),
    ],
)
def test_activity_history_policy_is_account_scoped(
    db_session,
    policy,
    override,
    enabled,
    source,
    blocked_reason,
):
    settings = AppSettings()
    settings.manager.feature_policies.activity_history = policy
    account = make_s3_account(db_session, name=f"Activity {policy.value} {override}", allow_activity_history=override)

    state = manager_resource_states(
        settings.manager.feature_policies,
        account,
        _manager_availability(),
    )["activity_history"]

    assert state.enabled is enabled
    assert state.source == source
    assert state.blocked_reason == blocked_reason


def test_activity_history_is_supported_for_rgw_users(db_session):
    settings = AppSettings()
    s3_user = S3User(
        name="activity-user",
        rgw_user_uid="activity-user",
        rgw_access_key="AK",
        rgw_secret_key="SK",
        storage_endpoint_id=1,
    )

    state = manager_resource_states(
        settings.manager.feature_policies,
        s3_user,
        _manager_availability(),
    )["activity_history"]

    assert state.enabled is True
    assert state.source == "platform"
    assert state.blocked_reason is None


def test_activity_history_is_supported_for_shared_connections():
    settings = AppSettings()
    connection = S3Connection(
        created_by_user_id=1,
        name="shared-activity",
        is_shared=True,
        access_manager=True,
        access_browser=False,
        access_key_id="AK",
        secret_access_key="SK",
        allow_activity_history=False,
    )

    state = manager_resource_states(
        settings.manager.feature_policies,
        None,
        _manager_availability(),
        activity_resource=connection,
    )["activity_history"]

    assert state.enabled is False
    assert state.source == "resource"
    assert state.blocked_reason == "resource_disabled"


def test_activity_history_override_explicit_null_restores_inheritance(client, db_session):
    account = make_s3_account(db_session, name="Activity inherited", allow_activity_history=False)
    db_session.add(account)
    db_session.commit()

    response = client.put(f"/api/admin/accounts/{account.id}", json={"allow_activity_history": None})

    assert response.status_code == 200, response.text
    assert response.json()["allow_activity_history"] is None
    db_session.refresh(account)
    assert account.allow_activity_history is None
