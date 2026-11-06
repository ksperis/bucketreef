# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.identity_provider import IdentityProviderFieldLock
from app.models.ldap import LDAPProviderAdminItem
from app.models.oidc import (
    OIDCProviderAdminItem,
    OIDCProviderInfo,
)


def test_oidc_provider_responses_require_complete_canonical_payloads() -> None:
    assert set(OIDCProviderInfo.model_json_schema()["required"]) == {
        "id",
        "display_name",
        "icon_url",
    }
    assert set(IdentityProviderFieldLock.model_json_schema()["required"]) == {
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
    assert set(IdentityProviderFieldLock.model_json_schema()["required"]) == {
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
        "import_search_filter",
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
