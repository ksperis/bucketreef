# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.scripts.check_production_hardening import run
from app.services.production_hardening import check_production_hardening, hardening_exit_code


def _production_settings(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "public_origin": "https://admin.example.test",
        "public_origins": ["https://app.example.test"],
        "webauthn_origin": "https://admin.example.test",
        "webauthn_origins": ["https://app.example.test"],
        "webauthn_rp_id": "example.test",
        "refresh_token_cookie_secure": True,
        "refresh_token_cookie_samesite": "lax",
        "refresh_token_cookie_domain": None,
        "require_registered_s3_login_endpoints": True,
        "allowed_hosts": ["admin.example.test", "app.example.test"],
        "trusted_proxy_cidrs": ["10.42.7.15/32"],
        "cors_origins": ["https://admin.example.test", "https://app.example.test"],
        "jwt_keys": ["legacy-jwt-key-that-is-at-least-32-bytes"],
        "ui_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "api_jwt_keys": ["api-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "credential_keys": ["credential-key-that-is-at-least-32-bytes"],
        "database_url": "postgresql+psycopg://bucketreef@example.test/bucketreef",
        "internal_cron_token": "internal-cron-token-that-is-at-least-32-bytes",
        "feature_admin_enabled": True,
        "feature_ceph_admin_enabled": True,
        "feature_storage_ops_enabled": True,
        "feature_manager_enabled": False,
        "feature_portal_enabled": False,
        "feature_browser_enabled": False,
        "scheduled_jobs_enabled": True,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_admin_profile_passes_hardening_checker():
    findings = check_production_hardening(_production_settings(), profile="admin")
    assert hardening_exit_code(findings) == 0
    assert all(finding.level == "pass" for finding in findings)


def test_user_profile_rejects_admin_surfaces_and_job_ownership():
    findings = check_production_hardening(_production_settings(), profile="user")
    failed_codes = {finding.code for finding in findings if finding.level == "fail"}
    assert "job-owner" in failed_codes
    assert "surface-admin" in failed_codes
    assert "surface-manager" in failed_codes
    assert hardening_exit_code(findings) == 1


def test_user_profile_passes_with_user_surface_contract():
    settings = _production_settings(
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=False,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=True,
        feature_portal_enabled=True,
        feature_browser_enabled=True,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
    )
    findings = check_production_hardening(settings, profile="user")
    assert hardening_exit_code(findings) == 0


def test_split_profile_requires_postgresql_and_all_shared_origins():
    settings = Settings(
        _env_file=None,
        database_url="sqlite:////tmp/bucketreef.db",
        public_origin="http://localhost:8080",
        webauthn_origin="http://localhost:8080",
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=False,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=True,
        feature_portal_enabled=True,
        feature_browser_enabled=True,
        scheduled_jobs_enabled=False,
    )
    findings = check_production_hardening(settings, profile="user")
    failed_codes = {finding.code for finding in findings if finding.level == "fail"}
    assert {"app-env", "keyrings", "database", "shared-origins"} <= failed_codes


@pytest.mark.parametrize(
    ("overrides", "expected_code"),
    [
        (
            {
                "app_env": "development",
                "public_origin": "http://admin.example.test",
                "webauthn_origin": "http://admin.example.test",
            },
            "trusted-origins",
        ),
        ({"app_env": "development", "refresh_token_cookie_secure": False}, "authentication-boundary"),
        ({"app_env": "development", "allowed_hosts": ["*"]}, "network-boundary"),
        (
            {
                "app_env": "development",
                "credential_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
            },
            "keyrings",
        ),
        (
            {"app_env": "development", "seed_s3_endpoint": "http://seed.example.test"},
            "seed-security",
        ),
        (
            {
                "app_env": "development",
                "oidc_providers": {
                    "corporate": {
                        "display_name": "Corporate",
                        "discovery_url": "https://idp.example.test/.well-known/openid-configuration",
                        "client_id": "bucketreef",
                        "redirect_uri": "https://admin.example.test/api/auth/oidc/corporate/callback",
                        "use_pkce": False,
                    }
                },
            },
            "oidc-security",
        ),
        (
            {
                "app_env": "development",
                "ldap_providers": {
                    "corporate": {
                        "display_name": "Corporate",
                        "url": "ldaps://ldap.example.test",
                        "user_base_dn": "ou=users,dc=example,dc=test",
                        "tls_verify": False,
                    }
                },
            },
            "ldap-security",
        ),
    ],
)
def test_checker_exposes_production_security_failures_before_app_env_switch(overrides, expected_code):
    settings = _production_settings(**overrides)

    findings = check_production_hardening(settings, profile="admin")

    failed_codes = {finding.code for finding in findings if finding.level == "fail"}
    assert expected_code in failed_codes


def test_cli_json_output_contains_no_secret_values():
    settings = _production_settings()
    exit_code, output = run(profile="admin", json_output=True, settings=settings)
    assert exit_code == 0
    parsed = json.loads(output)
    assert parsed
    assert settings.internal_cron_token not in output
    assert settings.credential_keys[0] not in output


def test_cli_uses_runtime_deployment_profile_when_not_overridden():
    settings = _production_settings(
        deployment_profile="user",
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=False,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=True,
        feature_portal_enabled=True,
        feature_browser_enabled=True,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
    )
    exit_code, output = run(json_output=False, settings=settings)

    assert exit_code == 0
    assert "surface-manager" in output
    assert "must be disabled" not in output


def test_ceph_admin_high_security_profile_passes_with_dedicated_contract():
    settings = _production_settings(
        deployment_profile="ceph-admin-high-security",
        ceph_admin_high_security_mode=True,
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=True,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=False,
        feature_portal_enabled=False,
        feature_browser_enabled=False,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
        public_origins=[],
        webauthn_origins=[],
        public_origin="https://ceph-admin.example.test",
        webauthn_origin="https://ceph-admin.example.test",
        webauthn_rp_id="ceph-admin.example.test",
        allowed_hosts=["ceph-admin.example.test"],
        cors_origins=["https://ceph-admin.example.test"],
    )
    findings = check_production_hardening(settings, profile="ceph-admin-high-security")
    assert hardening_exit_code(findings) == 0
    assert all(finding.level == "pass" for finding in findings)
    database_finding = next(finding for finding in findings if finding.code == "database")
    assert database_finding.message == "Dedicated Ceph Admin deployment uses PostgreSQL."


def test_ceph_admin_high_security_database_failure_allows_shared_or_isolated_database():
    settings = Settings(
        _env_file=None,
        deployment_profile="ceph-admin-high-security",
        database_url="sqlite:////tmp/bucketreef.db",
        ceph_admin_high_security_mode=True,
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=True,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=False,
        feature_portal_enabled=False,
        feature_browser_enabled=False,
        scheduled_jobs_enabled=False,
    )

    findings = check_production_hardening(settings, profile="ceph-admin-high-security")
    database_finding = next(finding for finding in findings if finding.code == "database")

    assert database_finding.level == "fail"
    assert "may be shared or isolated" in database_finding.message


def test_high_security_mode_rejects_wider_surface_contract():
    with pytest.raises(ValidationError, match="dedicated Ceph Admin surface contract"):
        Settings(
            _env_file=None,
            deployment_profile="ceph-admin-high-security",
            ceph_admin_high_security_mode=True,
            feature_ceph_admin_enabled=True,
            feature_admin_enabled=True,
            scheduled_jobs_enabled=False,
        )


def test_high_security_mode_requires_matching_runtime_profile():
    with pytest.raises(ValidationError, match="DEPLOYMENT_PROFILE=ceph-admin-high-security"):
        Settings(
            _env_file=None,
            ceph_admin_high_security_mode=True,
            feature_ceph_admin_enabled=True,
            feature_admin_enabled=False,
            feature_storage_ops_enabled=False,
            feature_manager_enabled=False,
            feature_portal_enabled=False,
            feature_browser_enabled=False,
            scheduled_jobs_enabled=False,
        )
