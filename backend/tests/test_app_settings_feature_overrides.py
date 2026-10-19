# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.db import AppSetting
from app.models import app_settings as app_settings_models
from app.models.app_settings import AppSettings, BrandingSettings, GeneralSettingsView, PortalSettingsOverride
from app.services import app_settings_service


def _runtime_settings(**overrides):
    defaults = {
        "app_settings_path": None,
        "feature_manager_enabled": None,
        "feature_browser_enabled": None,
        "feature_portal_enabled": None,
        "feature_ceph_admin_enabled": None,
        "feature_storage_ops_enabled": None,
        "feature_billing_enabled": None,
        "feature_endpoint_status_enabled": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _use_settings_db(monkeypatch, db_session) -> None:
    @contextmanager
    def _session():
        yield db_session

    monkeypatch.setattr(app_settings_service, "_open_settings_session", _session)


def _raw_db_settings(db_session) -> dict:
    row = db_session.get(AppSetting, app_settings_service.APP_SETTINGS_DB_KEY)
    assert row is not None
    return json.loads(row.payload_json)


def test_rgw_account_id_prefix_defaults_to_80_and_requires_one_to_three_digits():
    assert AppSettings().general.rgw_account_id_prefix == "80"

    for value in ("7", "80", "123"):
        assert AppSettings(general={"rgw_account_id_prefix": value}).general.rgw_account_id_prefix == value

    for value in ("", "1234", "ab", "8x"):
        with pytest.raises(ValidationError):
            AppSettings(general={"rgw_account_id_prefix": value})


def test_managed_rgw_tenant_creation_defaults_off_and_round_trips():
    assert AppSettings().general.allow_managed_rgw_tenant_creation is False
    assert (
        AppSettings(general={"allow_managed_rgw_tenant_creation": True})
        .general.allow_managed_rgw_tenant_creation
        is True
    )


def test_documentation_base_url_defaults_normalizes_and_validates():
    assert AppSettings().general.documentation_base_url == "https://docs.bucketreef.ksperis.com"
    assert (
        AppSettings(general={"documentation_base_url": " https://docs.example.com/bucketreef/ "})
        .general.documentation_base_url
        == "https://docs.example.com/bucketreef"
    )
    assert AppSettings(general={"documentation_base_url": "/docs/"}).general.documentation_base_url == "/docs"
    assert (
        AppSettings(general={"documentation_base_url": "   "}).general.documentation_base_url
        == "https://docs.bucketreef.ksperis.com"
    )

    for value in (
        "docs.example.com",
        "//docs.example.com",
        "ftp://docs.example.com",
        "https://docs.example.com/?tenant=1",
        "/docs#section",
    ):
        with pytest.raises(ValidationError):
            AppSettings(general={"documentation_base_url": value})


def test_load_app_settings_applies_feature_env_overrides(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.manager_enabled = False
    persisted.general.browser_enabled = True
    persisted.general.portal_enabled = False
    persisted.general.ceph_admin_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_manager_enabled=True,
            feature_browser_enabled=False,
            feature_portal_enabled=True,
        ),
    )

    effective = app_settings_service.load_app_settings()
    assert effective.general.manager_enabled is True
    assert effective.general.browser_enabled is False
    assert effective.general.portal_enabled is True
    # Not forced: persisted value is preserved.
    assert effective.general.ceph_admin_enabled is True
    assert _raw_db_settings(db_session)["general"]["ceph_admin_enabled"] is True


def test_save_app_settings_keeps_persisted_value_for_locked_features(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    persisted = AppSettings()
    persisted.general.manager_enabled = False
    persisted.general.billing_enabled = True
    settings_path.write_text(persisted.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(feature_manager_enabled=True, feature_billing_enabled=False),
    )

    payload = AppSettings()
    payload.general.manager_enabled = True
    payload.general.billing_enabled = False
    saved_effective = app_settings_service.save_app_settings(payload)

    raw = _raw_db_settings(db_session)
    # Locked fields keep persisted values in storage.
    assert raw["general"]["manager_enabled"] is False
    assert raw["general"]["billing_enabled"] is True
    # Returned settings expose effective forced values.
    assert saved_effective.general.manager_enabled is True
    assert saved_effective.general.billing_enabled is False


def test_app_settings_json_bootstrap_imports_once_to_db(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    bootstrap = AppSettings()
    bootstrap.general.browser_enabled = False
    settings_path.write_text(bootstrap.model_dump_json(indent=2), encoding="utf-8")

    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(app_settings_service, "get_settings", lambda: _runtime_settings())

    imported = app_settings_service.load_persisted_app_settings()
    assert imported.general.browser_enabled is False

    settings_path.unlink()
    loaded_again = app_settings_service.load_persisted_app_settings()
    assert loaded_again.general.browser_enabled is False
    assert db_session.scalar(select(func.count()).select_from(AppSetting)) == 1


def test_app_settings_json_bootstrap_rejects_removed_portal_key_setting(tmp_path):
    settings_path = tmp_path / "app_settings.json"
    settings_path.write_text(
        json.dumps({"portal": {"allow_portal_key": True}}),
        encoding="utf-8",
    )

    with pytest.raises(ValidationError):
        app_settings_service._load_persisted_settings_from_disk(settings_path)


def test_app_settings_db_errors_are_not_hidden_by_disk_fallback(monkeypatch):
    def _broken_session():
        raise RuntimeError("settings db unavailable")

    monkeypatch.setattr(app_settings_service, "_open_settings_session", _broken_session)

    with pytest.raises(RuntimeError, match="settings db unavailable"):
        app_settings_service.load_persisted_app_settings()
    with pytest.raises(RuntimeError, match="settings db unavailable"):
        app_settings_service.save_app_settings(AppSettings())


def test_app_settings_db_payload_is_parsed_strictly():
    with pytest.raises(ValidationError):
        app_settings_service._parse_settings_payload("{")
    with pytest.raises(ValidationError):
        app_settings_service._parse_settings_payload("[]")
    with pytest.raises(ValidationError):
        app_settings_service._parse_settings_payload(
            '{"branding":{"primary_color":"blue"}}'
        )


@pytest.mark.parametrize(
    "payload",
    [
        '{"general":{"bucket_usage_stats_enabled":false}}',
        '{"manager":{"manager_rgw_usage_metrics_enabled":false}}',
    ],
)
def test_app_settings_db_payload_rejects_legacy_usage_flags(payload):
    with pytest.raises(ValidationError):
        app_settings_service._parse_settings_payload(payload)


def test_general_settings_view_exposes_only_canonical_feature_policies():
    payload = GeneralSettingsView.from_settings(AppSettings()).model_dump(mode="json")

    assert payload["project_feature_policies"]["bucket_usage_stats"] == "default_on"
    assert payload["manager_feature_policies"]["bucket_compare"] == "targeted"
    for removed_field in (
        "bucket_usage_stats_enabled",
        "bucket_compare_enabled",
        "bucket_integrity_check_enabled",
        "bucket_migration_enabled",
        "bucket_purge_enabled",
        "bucket_quota_management_enabled",
        "manager_ceph_s3_user_keys_enabled",
        "manager_access_key_metadata_enabled",
        "manager_access_key_expiration_enabled",
        "managed_private_connection_provisioning_enabled",
    ):
        assert removed_field not in payload


@pytest.mark.parametrize(
    "payload",
    [
        {"general": {"bucket_compare_enabled": True}},
        {"general": {"bucket_usage_stats_enabled": False}},
        {"manager": {"manager_rgw_usage_metrics_enabled": False}},
    ],
)
def test_app_settings_disk_import_rejects_removed_feature_flags(tmp_path, payload):
    settings_path = tmp_path / "app_settings.json"
    settings_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValidationError):
        app_settings_service._load_persisted_settings_from_disk(settings_path)


def test_general_feature_locks_only_use_dedicated_feature_sources(monkeypatch):
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(
            feature_manager_enabled=False,
            feature_portal_enabled=True,
            feature_billing_enabled=None,
            feature_endpoint_status_enabled=None,
        ),
    )

    locks = app_settings_service.get_general_feature_locks()
    assert locks.manager_enabled.forced is True
    assert locks.manager_enabled.value is False
    assert locks.manager_enabled.source == "FEATURE_MANAGER_ENABLED"

    assert locks.portal_enabled.forced is True
    assert locks.portal_enabled.value is True
    assert locks.portal_enabled.source == "FEATURE_PORTAL_ENABLED"

    assert locks.billing_enabled.forced is False
    assert locks.billing_enabled.value is None
    assert locks.billing_enabled.source is None

    assert locks.endpoint_status_enabled.forced is False
    assert locks.endpoint_status_enabled.value is None
    assert locks.endpoint_status_enabled.source is None


def test_branding_settings_defaults_and_normalizes_hex():
    assert BrandingSettings().primary_color == "#0569f8"
    assert BrandingSettings().login_logo_url is None
    assert BrandingSettings(primary_color="  #A1B2C3 ").primary_color == "#a1b2c3"
    assert BrandingSettings(login_logo_url="  https://cdn.example.com/logo.svg ").login_logo_url == "https://cdn.example.com/logo.svg"
    assert BrandingSettings(login_logo_url="   ").login_logo_url is None
    assert AppSettings(branding={"primary_color": ""}).branding.primary_color == "#0569f8"


def test_branding_settings_reject_invalid_hex():
    with pytest.raises(ValidationError):
        BrandingSettings(primary_color="blue")


def test_branding_settings_reject_invalid_logo_url():
    with pytest.raises(ValidationError):
        BrandingSettings(login_logo_url="logo.svg")


def test_manager_ceph_s3_user_keys_flag_default_enabled():
    settings = AppSettings()
    assert settings.manager.feature_policies.ceph_s3_user_keys == "targeted"


def test_fresh_settings_enable_access_key_extensions_and_preserve_disabled_choices(monkeypatch, tmp_path, db_session):
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: tmp_path / "missing.json")
    monkeypatch.setattr(app_settings_service, "get_settings", _runtime_settings)
    _use_settings_db(monkeypatch, db_session)

    settings = app_settings_service.load_app_settings()
    features = ("access_key_metadata", "access_key_expiration")
    for feature in features:
        assert getattr(settings.manager.feature_policies, feature) == "targeted"
        assert _raw_db_settings(db_session)["manager"]["feature_policies"][feature] == "targeted"
        setattr(settings.manager.feature_policies, feature, "disabled")

    app_settings_service.save_app_settings(settings)
    reloaded = app_settings_service.load_app_settings()
    for feature in features:
        assert getattr(reloaded.manager.feature_policies, feature) == "disabled"
        assert _raw_db_settings(db_session)["manager"]["feature_policies"][feature] == "disabled"


def test_managed_private_connection_provisioning_flag_default_disabled():
    settings = AppSettings()
    assert settings.manager.feature_policies.managed_private_connection_provisioning == "disabled"


def test_fresh_app_settings_defaults_admin_passkeys_to_optional():
    settings = AppSettings()

    assert settings.general.require_passkey_for_admins is False
    assert settings.general.require_passkey_for_users is False
    assert settings.general.allow_user_profile_name_edit is False
    assert settings.general.allow_user_external_identity_unlink is False


def test_persisted_app_settings_without_admin_passkey_policy_uses_current_default():
    settings = app_settings_service._parse_settings_payload(
        json.dumps({"general": {"manager_enabled": False}})
    )

    assert settings.general.require_passkey_for_admins is False
    assert settings.general.require_passkey_for_users is False
    assert settings.general.allow_user_profile_name_edit is False
    assert settings.general.allow_user_external_identity_unlink is False


@pytest.mark.parametrize("required", [True, False])
def test_persisted_admin_passkey_policy_preserves_explicit_value(required):
    settings = app_settings_service._parse_settings_payload(
        json.dumps({"general": {"require_passkey_for_admins": required}})
    )

    assert settings.general.require_passkey_for_admins is required


def test_manager_rgw_usage_metrics_flag_default_enabled():
    settings = AppSettings()
    assert settings.manager.feature_policies.rgw_usage_metrics == "default_on"
    assert settings.general.project_feature_policies.bucket_usage_stats == "default_on"


def test_app_settings_defaults_are_built_from_current_runtime_config(monkeypatch):
    runtime = SimpleNamespace(
        cors_origins=["https://first.example"],
        bucket_migration_parallelism_max=3,
        bucket_migration_max_active_per_endpoint=2,
    )
    monkeypatch.setattr(app_settings_models, "get_settings", lambda: runtime)

    first = AppSettings()
    runtime.cors_origins = ["https://second.example"]
    runtime.bucket_migration_parallelism_max = 7
    runtime.bucket_migration_max_active_per_endpoint = 5
    second = AppSettings()

    assert first.portal.bucket_defaults.cors_allowed_origins == ["https://first.example"]
    assert first.manager.bucket_migration_parallelism_default == 3
    assert first.manager.bucket_migration_parallelism_max == 3
    assert first.manager.bucket_migration_max_active_per_endpoint == 2
    assert second.portal.bucket_defaults.cors_allowed_origins == ["https://second.example"]
    assert second.manager.bucket_migration_parallelism_default == 7
    assert second.manager.bucket_migration_parallelism_max == 7
    assert second.manager.bucket_migration_max_active_per_endpoint == 5
    assert first.general is not second.general


def test_portal_feature_flag_default_disabled():
    settings = AppSettings()
    assert settings.general.portal_enabled is False


def test_removed_portal_key_setting_is_rejected():
    with pytest.raises(ValidationError):
        AppSettings(portal={"allow_portal_key": True})
    with pytest.raises(ValidationError):
        PortalSettingsOverride(allow_portal_key=True)


def test_bucket_integrity_check_flag_default_enabled():
    settings = AppSettings()
    assert settings.manager.feature_policies.bucket_integrity_check == "targeted"


def test_bucket_purge_flag_default_disabled():
    settings = AppSettings()
    assert settings.manager.feature_policies.bucket_purge == "disabled"


def test_portal_storage_space_version_cleanup_default_enabled():
    settings = AppSettings()
    assert settings.portal.feature_policies.storage_space_version_cleanup == "default_on"


def test_portal_server_access_log_retention_default_days():
    settings = AppSettings()
    assert settings.portal.server_access_log_retention_days == 30


def test_portal_noncurrent_version_expiration_days_are_positive():
    settings = AppSettings()
    assert settings.portal.bucket_defaults.noncurrent_version_expiration_days == 90

    with pytest.raises(ValidationError):
        AppSettings(portal={"bucket_defaults": {"noncurrent_version_expiration_days": 0}})


def test_bucket_compare_flag_default_enabled():
    settings = AppSettings()
    assert settings.manager.feature_policies.bucket_compare == "targeted"


def test_endpoint_status_and_usage_history_default_enabled():
    settings = AppSettings()
    assert settings.general.endpoint_status_enabled is True
    assert settings.general.usage_history_enabled is True


def test_portal_browser_flag_default_enabled():
    settings = AppSettings()
    assert settings.general.browser_portal_enabled is True
    assert settings.portal.feature_policies.browser_access == "default_on"


def test_manager_ceph_s3_user_keys_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.manager.feature_policies.ceph_s3_user_keys = "targeted"
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.manager.feature_policies.ceph_s3_user_keys == "targeted"
    assert loaded.manager.feature_policies.ceph_s3_user_keys == "targeted"
    assert raw["manager"]["feature_policies"]["ceph_s3_user_keys"] == "targeted"


def test_managed_private_connection_provisioning_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.manager.feature_policies.managed_private_connection_provisioning = "targeted"
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.manager.feature_policies.managed_private_connection_provisioning == "targeted"
    assert loaded.manager.feature_policies.managed_private_connection_provisioning == "targeted"
    assert raw["manager"]["feature_policies"]["managed_private_connection_provisioning"] == "targeted"


def test_manager_rgw_usage_metrics_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.manager.feature_policies.rgw_usage_metrics = "disabled"
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.manager.feature_policies.rgw_usage_metrics == "disabled"
    assert loaded.manager.feature_policies.rgw_usage_metrics == "disabled"
    assert raw["manager"]["feature_policies"]["rgw_usage_metrics"] == "disabled"
    assert "manager_rgw_usage_metrics_enabled" not in raw["manager"]


def test_bucket_integrity_check_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.manager.feature_policies.bucket_integrity_check = "targeted"
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.manager.feature_policies.bucket_integrity_check == "targeted"
    assert loaded.manager.feature_policies.bucket_integrity_check == "targeted"
    assert raw["manager"]["feature_policies"]["bucket_integrity_check"] == "targeted"


def test_bucket_purge_flag_persists(monkeypatch, tmp_path, db_session):
    settings_path = tmp_path / "app_settings.json"
    monkeypatch.setattr(app_settings_service, "_settings_path", lambda: settings_path)
    _use_settings_db(monkeypatch, db_session)
    monkeypatch.setattr(
        app_settings_service,
        "get_settings",
        lambda: _runtime_settings(),
    )

    payload = AppSettings()
    payload.manager.feature_policies.bucket_purge = "targeted"
    saved = app_settings_service.save_app_settings(payload)
    loaded = app_settings_service.load_app_settings()
    raw = _raw_db_settings(db_session)

    assert saved.manager.feature_policies.bucket_purge == "targeted"
    assert loaded.manager.feature_policies.bucket_purge == "targeted"
    assert raw["manager"]["feature_policies"]["bucket_purge"] == "targeted"
