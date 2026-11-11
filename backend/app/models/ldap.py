# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator

from app.core.domain_enums import IdentityProviderSource, LDAPLinkingPolicy
from app.models.base import ApiModel
from app.models.identity_provider import IdentityProviderFieldLock
from app.utils.identity_provider_ids import normalize_identity_provider_id
from app.utils.ldap_validation import (
    LDAPImportSearchFilter,
    LDAPOptionalString,
    LDAPRequiredString,
    LDAPUrl,
    LDAPUserFilter,
)

LDAP_USERNAME_MAX_LENGTH = 256
LDAP_PASSWORD_MAX_LENGTH = 1024
LDAP_PROVIDER_CONFIG_FIELDS = (
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
    "linking_policy",
)


class LDAPProviderInfo(ApiModel):
    id: str
    display_name: str


class LDAPLoginRequest(ApiModel):
    username: str = Field(min_length=1, max_length=LDAP_USERNAME_MAX_LENGTH)
    password: str = Field(min_length=1, max_length=LDAP_PASSWORD_MAX_LENGTH)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        if not isinstance(value, str):
            raise ValueError("username must be a string")
        normalized = value.strip()
        if not normalized:
            raise ValueError("username cannot be empty")
        return normalized


class LDAPProviderAdminItem(ApiModel):
    provider_id: str
    display_name: str
    url: str
    bind_dn: Optional[str]
    user_base_dn: str
    user_filter: str
    import_search_filter: Optional[str]
    email_attribute: str
    name_attribute: Optional[str]
    subject_attribute: Optional[str]
    start_tls: bool
    tls_verify: bool
    tls_ca_file: Optional[str]
    allow_legacy_tls: bool
    timeout_seconds: float
    enabled: bool
    allow_insecure: bool
    linking_policy: LDAPLinkingPolicy = "manual"
    source: IdentityProviderSource
    editable: bool
    field_locks: dict[str, IdentityProviderFieldLock]
    has_bind_password: bool


class LDAPProviderAdminPayload(ApiModel):
    provider_id: str
    display_name: LDAPRequiredString
    url: LDAPUrl
    bind_dn: LDAPOptionalString
    bind_password: LDAPOptionalString = None
    user_base_dn: LDAPRequiredString
    user_filter: LDAPUserFilter
    import_search_filter: LDAPImportSearchFilter = None
    email_attribute: LDAPRequiredString
    name_attribute: LDAPOptionalString
    subject_attribute: LDAPOptionalString
    start_tls: bool
    tls_verify: bool
    tls_ca_file: LDAPOptionalString
    allow_legacy_tls: bool
    timeout_seconds: float = Field(..., gt=0, le=60)
    enabled: bool
    allow_insecure: bool
    linking_policy: LDAPLinkingPolicy = "manual"
    clear_bind_password: bool = False

    normalize_provider_id = field_validator("provider_id", mode="before")(normalize_identity_provider_id)

    @model_validator(mode="after")
    def validate_transport(self):
        if self.bind_password and not self.bind_dn:
            raise ValueError("LDAP provider bind_password requires bind_dn")
        parsed = urlparse(self.url)
        if parsed.scheme == "ldaps" and self.start_tls:
            raise ValueError("LDAP provider start_tls cannot be used with ldaps:// URLs")
        if parsed.scheme == "ldap" and not self.start_tls and not self.allow_insecure:
            raise ValueError("LDAP provider requires LDAPS or START_TLS unless allow_insecure=true")
        return self
