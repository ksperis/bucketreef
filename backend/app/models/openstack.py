# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from app.models.base import ApiModel


class OpenStackCloudWrite(ApiModel):
    name: str = Field(min_length=1, max_length=128)
    auth_url: str = Field(max_length=2048)
    enabled: bool = False
    allow_password: bool = True
    allow_token: bool = True
    managed_endpoints_only: bool = False
    default_domain: str | None = Field(default=None, max_length=255)

    @field_validator("auth_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Keystone URL must be HTTPS without credentials, query or fragment")
        value = value.rstrip("/")
        if not urlsplit(value).path.endswith("/v3"):
            raise ValueError("Keystone URL must end with /v3")
        return value

    @model_validator(mode="after")
    def validate_modes(self):
        if not self.allow_password and not self.allow_token:
            raise ValueError("At least one authentication method is required")
        return self


class OpenStackCloudRead(OpenStackCloudWrite):
    id: int


class OpenStackCloudPublic(ApiModel):
    id: int
    name: str
    allow_password: bool
    allow_token: bool
    default_domain: str | None


class LinkedOpenStackCloud(ApiModel):
    id: int
    name: str


class OpenStackAuthenticate(ApiModel):
    cloud_id: int
    method: Literal["password", "token"]
    username: str | None = Field(default=None, max_length=255)
    user_id: str | None = Field(default=None, max_length=255)
    domain: str | None = Field(default=None, max_length=255)
    domain_is_id: bool = False
    password: SecretStr | None = None
    token: SecretStr | None = None

    @model_validator(mode="after")
    def validate_auth(self):
        if self.method == "password" and (not (self.username or self.user_id) or not self.password or not self.password.get_secret_value()):
            raise ValueError("User identity and password are required")
        if self.method == "token" and (not self.token or not self.token.get_secret_value()):
            raise ValueError("A user token is required")
        return self


class OpenStackConnectionRead(ApiModel):
    id: str
    cloud_id: int
    cloud_name: str
    display_name: str
    keystone_user_id: str
    connected: bool
    expires_at: datetime | None


class OpenStackProjectOptionRead(ApiModel):
    connection_id: str
    cloud_id: int
    cloud_name: str
    identity_name: str
    keystone_user_id: str
    project_id: str
    project_name: str
    project_domain_id: str | None = None


class OpenStackProjectOptionWarning(ApiModel):
    connection_id: str
    cloud_name: str
    identity_name: str
    code: str


class OpenStackProjectOptionsRead(ApiModel):
    options: list[OpenStackProjectOptionRead]
    warnings: list[OpenStackProjectOptionWarning] = Field(default_factory=list)


class OpenStackProjectRead(ApiModel):
    project_id: str
    project_name: str
    project_domain_id: str | None = None


class OpenStackTargetRead(ApiModel):
    target_id: str
    region_id: str
    interface: Literal["public", "internal"]
    service_type: str
    service_name: str | None = None
    endpoint_url: str
    storage_endpoint_id: int | None = None
    storage_endpoint_name: str | None = None
    allowed: bool = True


class OpenStackProjectAccessRead(ApiModel):
    targets: list[OpenStackTargetRead]
    access_keys: list[str]


class OpenStackActivate(ApiModel):
    project_id: str = Field(min_length=1, max_length=255)
    target_id: str = Field(min_length=1, max_length=1024)
    access_key: str | None = Field(default=None, max_length=1024)


class OpenStackPrivateConnectionCreate(ApiModel):
    connection_name: str = Field(min_length=1, max_length=255)
    target_id: str = Field(min_length=1, max_length=1024)
    access_key: str | None = Field(default=None, max_length=1024)
    access_manager: bool = False
    access_browser: bool = True


class OpenStackContextRead(ApiModel):
    context_id: str
