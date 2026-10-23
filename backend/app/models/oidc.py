# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel
from app.utils.identity_provider_ids import normalize_identity_provider_id
from app.utils.oidc_validation import normalize_trusted_email_domains


OIDC_PROVIDER_DEFAULT_SCOPES = ["openid", "email", "profile"]
OIDC_PROVIDER_CONFIG_FIELDS = (
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
)


class OIDCProviderInfo(ApiModel):
    id: str
    display_name: str
    icon_url: Optional[str]


class OIDCStartRequest(ApiModel):
    redirect_path: Optional[str] = None


class OIDCStartResponse(ApiModel):
    provider: str
    authorization_url: str
    state: str


class OIDCCallbackRequest(ApiModel):
    code: str
    state: str


class OIDCProviderFieldLock(ApiModel):
    forced: bool
    source: Optional[str]


class OIDCProviderAdminItem(ApiModel):
    provider_id: str
    display_name: str
    discovery_url: str
    client_id: str
    redirect_uri: str
    scopes: list[str]
    prompt: Optional[str]
    enabled: bool
    icon_url: Optional[str]
    use_pkce: bool
    use_nonce: bool
    linking_policy: Literal["manual", "trusted_email"]
    trusted_email_domains: list[str]
    source: Literal["environment", "ui"]
    editable: bool
    field_locks: dict[str, OIDCProviderFieldLock]
    has_client_secret: bool


class OIDCProviderAdminPayload(ApiModel):
    provider_id: str
    display_name: str
    discovery_url: str
    client_id: str
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: list(OIDC_PROVIDER_DEFAULT_SCOPES))
    prompt: Optional[str] = None
    enabled: bool = True
    icon_url: Optional[str] = None
    use_pkce: bool = True
    use_nonce: bool = True
    linking_policy: Literal["manual", "trusted_email"] = "manual"
    trusted_email_domains: list[str] = Field(default_factory=list)
    client_secret: Optional[str] = None
    clear_client_secret: bool = False

    normalize_provider_id = field_validator("provider_id", mode="before")(normalize_identity_provider_id)

    @field_validator("display_name", "discovery_url", "client_id", "redirect_uri", mode="before")
    @classmethod
    def normalize_required_strings(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("OIDC provider fields must be strings")
        normalized = value.strip()
        if not normalized:
            raise ValueError("OIDC provider fields cannot be empty")
        return normalized

    @field_validator("prompt", "icon_url", "client_secret", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("OIDC provider fields must be strings")
        normalized = value.strip()
        return normalized or None

    @field_validator("scopes")
    @classmethod
    def normalize_scopes(cls, value: list[str]) -> list[str]:
        normalized = [item.strip() for item in value if item.strip()]
        return normalized or list(OIDC_PROVIDER_DEFAULT_SCOPES)

    @field_validator("trusted_email_domains")
    @classmethod
    def normalize_domains(cls, value: list[str]) -> list[str]:
        return normalize_trusted_email_domains(value)
