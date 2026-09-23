# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _valid_production_settings(**overrides):
    values = {
        "app_env": "production",
        "public_origin": "https://s3.example.test",
        "webauthn_origin": "https://s3.example.test",
        "webauthn_rp_id": "s3.example.test",
        "refresh_token_cookie_secure": True,
        "refresh_token_cookie_samesite": "lax",
        "refresh_token_cookie_domain": None,
        "require_registered_s3_login_endpoints": True,
        "allowed_hosts": ["s3.example.test"],
        "trusted_proxy_cidrs": ["10.42.7.15/32"],
        "cors_origins": ["https://s3.example.test"],
        "jwt_keys": ["legacy-jwt-key-that-is-at-least-32-bytes"],
        "ui_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "api_jwt_keys": ["api-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "credential_keys": ["credential-key-that-is-at-least-32-bytes"],
        "internal_cron_token": "internal-cron-token-that-is-at-least-32-bytes",
        "seed_s3_endpoint": "https://s3-storage.example.test",
        "seed_s3_secret_key": "seed-s3-secret-that-is-at-least-32-bytes",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _oidc_provider(**overrides):
    values = {
        "display_name": "Corporate OIDC",
        "discovery_url": "https://idp.example.test/.well-known/openid-configuration",
        "client_id": "bucketreef",
        "redirect_uri": "https://s3.example.test/api/auth/oidc/corporate/callback",
    }
    values.update(overrides)
    return {"corporate": values}


def _ldap_provider(**overrides):
    values = {
        "display_name": "Corporate LDAP",
        "url": "ldaps://ldap.example.test",
        "user_base_dn": "ou=users,dc=example,dc=test",
    }
    values.update(overrides)
    return {"corporate": values}


def test_settings_ignore_removed_singular_key_variables(monkeypatch):
    monkeypatch.setenv("FERNET_KEY", "legacy-jwt-key")
    monkeypatch.setenv("CREDENTIAL_KEY", "legacy-credential-key")
    monkeypatch.delenv("JWT_KEYS", raising=False)
    monkeypatch.delenv("CREDENTIAL_KEYS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.jwt_keys == ["change-me"]
    assert settings.credential_keys == ["change-me"]
    assert not hasattr(settings, "fernet_key")
    assert not hasattr(settings, "credential_key")


def test_settings_load_json_keyrings(monkeypatch):
    monkeypatch.setenv("JWT_KEYS", '["jwt-primary", "jwt-previous"]')
    monkeypatch.setenv("CREDENTIAL_KEYS", '["credential-primary", "credential-previous"]')

    settings = Settings(_env_file=None)

    assert settings.jwt_keys == ["jwt-primary", "jwt-previous"]
    assert settings.credential_keys == ["credential-primary", "credential-previous"]


def test_settings_parse_outbound_host_allowlists(monkeypatch):
    monkeypatch.setenv(
        "USER_SUPPLIED_S3_ENDPOINT_ALLOWED_HOSTS",
        '["s3.example.test", "*.storage.example.test"]',
    )
    monkeypatch.setenv("BUCKET_MIGRATION_WEBHOOK_ALLOWED_HOSTS", '["hooks.example.test", "*.events.example.test"]')

    settings = Settings(_env_file=None)

    assert settings.user_supplied_s3_endpoint_allowed_hosts == [
        "s3.example.test",
        "*.storage.example.test",
    ]
    assert settings.bucket_migration_webhook_allowed_hosts == [
        "hooks.example.test",
        "*.events.example.test",
    ]


@pytest.mark.parametrize("variable", ["JWT_KEYS", "CREDENTIAL_KEYS"])
def test_settings_reject_empty_keyrings(monkeypatch, variable):
    monkeypatch.setenv(variable, "[]")

    with pytest.raises(ValidationError, match="must contain at least one key"):
        Settings(_env_file=None)


def test_valid_production_authentication_configuration_is_accepted():
    settings = _valid_production_settings()
    assert settings.app_env == "production"


def test_valid_production_multi_origin_webauthn_configuration_is_accepted():
    settings = _valid_production_settings(
        public_origin="https://admin.example.test",
        public_origins=["https://app.example.test"],
        webauthn_origin="https://admin.example.test",
        webauthn_origins=["https://app.example.test"],
        webauthn_rp_id="example.test",
        allowed_hosts=["admin.example.test", "app.example.test"],
        cors_origins=["https://admin.example.test", "https://app.example.test"],
    )
    assert settings.effective_public_origins() == ["https://admin.example.test", "https://app.example.test"]
    assert settings.effective_webauthn_origins() == ["https://admin.example.test", "https://app.example.test"]


def test_valid_production_external_identity_configuration_is_accepted():
    settings = _valid_production_settings(
        oidc_providers=_oidc_provider(),
        ldap_providers=_ldap_provider(),
    )

    assert settings.oidc_providers["corporate"].enabled is True
    assert settings.ldap_providers["corporate"].tls_verify is True


def test_disabled_external_identity_providers_do_not_apply_production_security_policy():
    settings = _valid_production_settings(
        oidc_providers=_oidc_provider(
            enabled=False,
            use_pkce=False,
            use_nonce=False,
            discovery_url="http://idp.example.test/.well-known/openid",
            redirect_uri="http://other.example.test/callback",
        ),
        ldap_providers=_ldap_provider(enabled=False, allow_legacy_tls=True),
    )

    assert settings.oidc_providers["corporate"].enabled is False
    assert settings.ldap_providers["corporate"].enabled is False


@pytest.mark.parametrize(
    "override",
    [
        {"public_origin": "http://s3.example.test"},
        {"webauthn_origin": "https://other.example.test"},
        {"webauthn_rp_id": "other.example.test"},
        {"refresh_token_cookie_secure": False},
        {"refresh_token_cookie_domain": ".example.test"},
        {"refresh_token_cookie_samesite": "strict"},
        {"require_registered_s3_login_endpoints": False},
        {"allowed_hosts": ["other.example.test"]},
        {"allowed_hosts": ["*"]},
        {"cors_origins": ["https://other.example.test"]},
        {"trusted_proxy_cidrs": []},
        {"trusted_proxy_cidrs": ["0.0.0.0/0"]},
        {"ui_jwt_keys": ["change-me"]},
        {"api_jwt_keys": ["change-me"]},
        {"credential_keys": ["change-me"]},
        {"api_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"]},
        {"credential_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"]},
        {"seed_s3_endpoint": "http://s3-storage.example.test"},
        {"seed_s3_secret_key": "minio123"},
        {"internal_cron_token": "change-me"},
        {"internal_cron_token": None},
        {"oidc_providers": _oidc_provider(use_pkce=False)},
        {"oidc_providers": _oidc_provider(use_nonce=False)},
        {"oidc_providers": _oidc_provider(discovery_url="http://idp.example.test/.well-known/openid")},
        {"oidc_providers": _oidc_provider(redirect_uri="https://other.example.test/callback")},
        {"ldap_providers": _ldap_provider(tls_verify=False)},
        {"ldap_providers": _ldap_provider(allow_legacy_tls=True)},
    ],
)
def test_production_policy_risks_are_parsed_before_the_readiness_engine_classifies_them(override):
    settings = _valid_production_settings(**override)

    assert settings.app_env == "production"


def test_production_allows_webauthn_origin_outside_public_origins_for_readiness_diagnostics():
    settings = _valid_production_settings(
        webauthn_origins=["https://passkeys.example.test"],
        webauthn_rp_id="example.test",
    )

    assert settings.webauthn_origins == ["https://passkeys.example.test"]
