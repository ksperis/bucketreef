# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.models.external_identity_link import ExternalIdentityLinkLdapProof
from app.models.identity_security import AdminExternalIdentityRequest


def test_admin_external_identity_request_canonicalizes_oidc_provider_and_issuer() -> None:
    payload = AdminExternalIdentityRequest(
        provider_type="oidc",
        provider_id=" Company ",
        issuer=" https://issuer.example.test/// ",
        subject="subject-1",
    )

    assert payload.provider_id == "company"
    assert payload.issuer == "https://issuer.example.test"


@pytest.mark.parametrize("provider_id", ["", "bad provider", "company!", 42])
def test_admin_external_identity_request_rejects_invalid_provider_id(provider_id: object) -> None:
    with pytest.raises(ValidationError, match="provider_id"):
        AdminExternalIdentityRequest(
            provider_type="oidc",
            provider_id=provider_id,
            issuer="https://issuer.example.test",
            subject="subject-1",
        )


def test_admin_external_identity_request_requires_oidc_issuer() -> None:
    with pytest.raises(ValidationError, match="OIDC issuer is required"):
        AdminExternalIdentityRequest(
            provider_type="oidc",
            provider_id="company",
            subject="subject-1",
        )


def test_admin_external_identity_request_rejects_ldap_issuer() -> None:
    with pytest.raises(ValidationError, match="issuer is only valid for OIDC identities"):
        AdminExternalIdentityRequest(
            provider_type="ldap",
            provider_id="company",
            issuer="https://issuer.example.test",
            subject="subject-1",
        )


def test_external_identity_link_ldap_proof_canonicalizes_provider_id() -> None:
    payload = ExternalIdentityLinkLdapProof(
        provider_id=" Company ",
        username="user",
        password="secret",
    )

    assert payload.provider_id == "company"


@pytest.mark.parametrize("provider_id", ["", "bad provider", "company!", 42])
def test_external_identity_link_ldap_proof_rejects_invalid_provider_id(provider_id: object) -> None:
    with pytest.raises(ValidationError, match="provider_id"):
        ExternalIdentityLinkLdapProof(
            provider_id=provider_id,
            username="user",
            password="secret",
        )
