# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.ldap import LDAPProviderAdminItem, LDAPProviderFieldLock
from app.models.oidc import (
    OIDCProviderAdminItem,
    OIDCProviderFieldLock,
    OIDCProviderInfo,
)


def test_oidc_provider_responses_require_complete_canonical_payloads() -> None:
    assert set(OIDCProviderInfo.model_json_schema()["required"]) == {
        "id",
        "display_name",
        "icon_url",
    }
    assert set(OIDCProviderFieldLock.model_json_schema()["required"]) == {
        "forced",
        "source",
    }
    assert set(OIDCProviderAdminItem.model_json_schema()["required"]) == {
        "provider_id",
        "display_name",
        "discovery_url",
        "client_id",
        "redirect_uri",
        "scopes",
        "prompt",
        "enabled",
        "icon_url",
        "use_pkce",
        "use_nonce",
        "linking_policy",
        "trusted_email_domains",
        "source",
        "editable",
        "field_locks",
        "has_client_secret",
    }


def test_ldap_provider_responses_require_complete_canonical_payloads() -> None:
    assert set(LDAPProviderFieldLock.model_json_schema()["required"]) == {
        "forced",
        "source",
    }
    assert set(LDAPProviderAdminItem.model_json_schema()["required"]) == {
        "provider_id",
        "display_name",
        "url",
        "bind_dn",
        "user_base_dn",
        "user_filter",
        "email_attribute",
        "name_attribute",
        "subject_attribute",
        "start_tls",
        "tls_verify",
        "tls_ca_file",
        "allow_legacy_tls",
        "timeout_seconds",
        "enabled",
        "allow_insecure",
        "source",
        "editable",
        "field_locks",
        "has_bind_password",
    }
