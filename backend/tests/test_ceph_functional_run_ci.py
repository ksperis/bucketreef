# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from types import SimpleNamespace

from app.models.app_settings import AppSettings
from app.models.feature_policy import FeaturePolicy
from app.services.storage_endpoint_normalization import (
    normalize_env_storage_endpoint_states,
    parse_env_storage_endpoints,
)
from tests_ceph_functional.bootstrap_session import _grant_functional_test_access
from tests_ceph_functional.clients import CephVerifier
from tests_ceph_functional import run_ci


def _seed_required_endpoint_env(monkeypatch):
    monkeypatch.setenv("CEPH_TEST_LAB_S3_ENDPOINT", "https://s3.example.test")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_ENDPOINT", "https://admin.example.test")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_ACCESS_KEY", "admin-ak")
    monkeypatch.setenv("CEPH_TEST_RGW_ADMIN_SECRET_KEY", "admin-sk")
    monkeypatch.setenv("CEPH_TEST_CEPH_ADMIN_ACCESS_KEY", "ceph-admin-ak")
    monkeypatch.setenv("CEPH_TEST_CEPH_ADMIN_SECRET_KEY", "ceph-admin-sk")
    monkeypatch.setenv("CEPH_TEST_SUPERVISION_ACCESS_KEY", "supervision-ak")
    monkeypatch.setenv("CEPH_TEST_SUPERVISION_SECRET_KEY", "supervision-sk")


def test_ci_endpoint_payload_enables_replication(monkeypatch):
    _seed_required_endpoint_env(monkeypatch)
    monkeypatch.delenv("CEPH_TEST_LAB_S3_ENDPOINT_Z2", raising=False)

    payload = json.loads(run_ci._build_endpoint_payload())

    assert len(payload) == 1
    assert payload[0]["name"] == "Lab Ceph"
    assert payload[0]["endpoint_url"] == "https://s3.example.test"
    assert payload[0]["is_default"] is True
    assert payload[0]["features"]["account"] == {"enabled": True}
    assert payload[0]["features"]["replication"] == {"enabled": True}
    assert payload[0]["ceph_admin_allowed"] is True
    assert payload[0]["ceph_admin_access_key"] == "ceph-admin-ak"
    states = normalize_env_storage_endpoint_states(
        parse_env_storage_endpoints(json.dumps(payload))
    )
    assert len(states) == 1
    assert states[0].service_identity_mode == "managed"


def test_ci_app_settings_payload_enables_portal_features():
    payload = json.loads(run_ci._build_app_settings_payload())

    assert payload["general"]["portal_enabled"] is True
    assert payload["general"]["browser_portal_enabled"] is True


def test_ci_app_settings_payload_matches_current_schema_and_enables_suite_features():
    settings = AppSettings.model_validate_json(run_ci._build_app_settings_payload())

    for feature in ("bucket_migration", "bucket_compare", "bucket_integrity_check", "ceph_s3_user_keys"):
        assert getattr(settings.manager.feature_policies, feature) == FeaturePolicy.DEFAULT_ON
    assert settings.general.project_feature_policies.bucket_usage_stats == FeaturePolicy.DEFAULT_ON


def test_functional_bootstrap_grants_all_suite_access():
    user = SimpleNamespace(
        can_access_ceph_admin=False,
        can_access_storage_ops=False,
        can_access_manager_bucket_compare=False,
        can_access_manager_bucket_integrity_check=False,
        can_access_manager_bucket_migration=False,
        can_access_manager_feature_rules=False,
        can_access_manager_bucket_purge=False,
    )

    _grant_functional_test_access(user)

    assert user.can_access_ceph_admin is True
    assert user.can_access_storage_ops is True
    assert user.can_access_manager_bucket_compare is True
    assert user.can_access_manager_bucket_integrity_check is True
    assert user.can_access_manager_bucket_migration is True
    assert user.can_access_manager_feature_rules is True
    assert user.can_access_manager_bucket_purge is True


def test_ci_endpoint_payload_can_seed_two_lab_zones(monkeypatch):
    _seed_required_endpoint_env(monkeypatch)
    monkeypatch.setenv("CEPH_TEST_LAB_S3_ENDPOINT_Z2", "https://s3-z2.example.test")

    payload = json.loads(run_ci._build_endpoint_payload())

    assert [item["name"] for item in payload] == ["s3-z1", "s3-z2"]
    assert [item["endpoint_url"] for item in payload] == [
        "https://s3.example.test",
        "https://s3-z2.example.test",
    ]
    assert [item["is_default"] for item in payload] == [True, False]
    assert [item["features"]["sts"]["endpoint"] for item in payload] == [
        "https://s3.example.test",
        "https://s3-z2.example.test",
    ]
    assert payload[0]["admin_access_key"] == payload[1]["admin_access_key"] == "admin-ak"


def test_ci_endpoint_payload_can_use_env_storage_endpoints():
    storage_endpoints = [
        {
            "name": "s3-z1",
            "endpoint_url": "https://s3-z1.example.test",
            "provider": "ceph",
            "region": "us-east-1",
            "verify_tls": True,
            "features": {
                "admin": {"enabled": True, "endpoint": "https://admin-z1.example.test"},
                "account": {"enabled": True},
                "sns": {"enabled": True},
            },
            "admin_access_key": "admin-ak",
            "admin_secret_key": "admin-sk",
            "ceph_admin_allowed": True,
            "ceph_admin_access_key": "ceph-admin-ak",
            "ceph_admin_secret_key": "ceph-admin-sk",
            "supervision_access_key": "supervision-ak",
            "supervision_secret_key": "supervision-sk",
            "is_default": True,
        }
    ]
    env = {"ENV_STORAGE_ENDPOINTS": json.dumps(storage_endpoints)}

    assert json.loads(run_ci._build_endpoint_payload(env)) == storage_endpoints

    run_ci._derive_ceph_test_env_from_storage_endpoints(env)

    assert env["CEPH_TEST_LAB_S3_ENDPOINT"] == "https://s3-z1.example.test"
    assert env["CEPH_TEST_RGW_ADMIN_ENDPOINT"] == "https://admin-z1.example.test"
    assert env["CEPH_TEST_RGW_ADMIN_ACCESS_KEY"] == "admin-ak"
    assert env["CEPH_TEST_CEPH_ADMIN_ACCESS_KEY"] == "ceph-admin-ak"
    assert env["CEPH_TEST_SUPERVISION_SECRET_KEY"] == "supervision-sk"
    assert env["CEPH_TEST_RGW_VERIFY_TLS"] == "true"


def _verifier_settings(**overrides):
    values = {
        "rgw_admin_endpoint": "https://admin.example.test",
        "rgw_admin_access_key": "admin-ak",
        "rgw_admin_secret_key": "admin-sk",
        "ceph_admin_access_key": None,
        "ceph_admin_secret_key": None,
        "rgw_admin_region": "us-east-1",
        "rgw_ca_bundle": None,
        "rgw_verify_tls": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_ceph_verifier_prefers_dedicated_ceph_admin_credentials():
    verifier = CephVerifier(
        _verifier_settings(
            ceph_admin_access_key="ceph-admin-ak",
            ceph_admin_secret_key="ceph-admin-sk",
        )
    )

    assert verifier.client.access_key == "ceph-admin-ak"
    assert verifier.client.secret_key == "ceph-admin-sk"


def test_ceph_verifier_rejects_partial_ceph_admin_credentials():
    try:
        CephVerifier(_verifier_settings(ceph_admin_access_key="ceph-admin-ak"))
    except RuntimeError as exc:
        assert str(exc) == "Ceph Admin credentials must be configured as a complete pair"
    else:
        raise AssertionError("CephVerifier accepted a partial Ceph Admin credential pair")


def test_prepare_environment_generates_keyring_settings(monkeypatch, tmp_path):
    _seed_required_endpoint_env(monkeypatch)
    monkeypatch.setenv("CI", "true")
    monkeypatch.setenv("JWT_KEYS", '["ambient-jwt-value"]')
    monkeypatch.delenv("UI_JWT_KEYS", raising=False)
    monkeypatch.delenv("API_JWT_KEYS", raising=False)
    monkeypatch.delenv("CREDENTIAL_KEYS", raising=False)

    env = run_ci._prepare_environment(tmp_path, "http://127.0.0.1:8765")

    assert "JWT_KEYS" not in env
    assert len(json.loads(env["UI_JWT_KEYS"])) == 1
    assert len(json.loads(env["API_JWT_KEYS"])) == 1
    assert len(json.loads(env["CREDENTIAL_KEYS"])) == 1
    assert env["PUBLIC_ORIGIN"] == "http://127.0.0.1:8765"
    assert json.loads(env["CORS_ORIGINS"]) == ["http://127.0.0.1:8765"]
    assert env["CEPH_TEST_REQUEST_ORIGIN"] == "http://127.0.0.1:8765"
    assert env["ACCESS_TOKEN_EXPIRE_MINUTES"] == "15"
    assert env["MFA_RECENT_MINUTES"] == "60"


def test_bootstrap_super_admin_session_exports_cookie_material(monkeypatch, tmp_path):
    payload = {
        "access_cookie_name": "ui_access",
        "access_cookie_value": "access-value",
        "refresh_cookie_name": "refresh_token",
        "refresh_cookie_value": "refresh-value",
        "csrf_cookie_name": "csrf_token",
        "csrf_cookie_value": "csrf-value",
    }
    monkeypatch.setattr(
        run_ci.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout=json.dumps(payload),
            stderr="",
        ),
    )
    env: dict[str, str] = {}

    run_ci._bootstrap_super_admin_session(tmp_path, env)

    assert env["CEPH_TEST_ACCESS_COOKIE_NAME"] == "ui_access"
    assert env["CEPH_TEST_REFRESH_COOKIE_NAME"] == "refresh_token"
    assert env["CEPH_TEST_CSRF_COOKIE_NAME"] == "csrf_token"
    assert env["CEPH_TEST_BOOTSTRAP_ACCESS_COOKIE"] == "access-value"
    assert env["CEPH_TEST_BOOTSTRAP_REFRESH_COOKIE"] == "refresh-value"
    assert env["CEPH_TEST_BOOTSTRAP_CSRF_TOKEN"] == "csrf-value"
