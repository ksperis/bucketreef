# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, SecretStr, model_validator

from app.models.base import ApiModel


OnboardingWorkspace = Literal["browser", "manager", "portal", "ceph-admin"]
OnboardingIntent = Literal["evaluate", "personal", "organization"]


class OnboardingDraft(ApiModel):
    model_config = ConfigDict(extra="forbid")

    intent: OnboardingIntent = "evaluate"
    workspace: OnboardingWorkspace = "browser"
    name: str = Field(default="My storage", min_length=1, max_length=120)
    resource_kind: Literal["connection", "account", "endpoint"] = "connection"
    beneficiary_user_id: int | None = Field(default=None, gt=0)
    endpoint_id: int | None = Field(default=None, gt=0)
    connection_id: int | None = Field(default=None, gt=0)
    account_id: int | None = Field(default=None, gt=0)
    endpoint_url: str = Field(default="", max_length=2048)
    region: str = Field(default="", max_length=100)
    force_path_style: bool = True
    grant_access: bool = False
    bucket: str = Field(default="", max_length=255)
    prefix: str = Field(default="", max_length=1024)
    space_id: str = Field(default="", max_length=255)
    space_name: str = Field(default="", max_length=120)
    space_visibility: Literal["private", "shared"] = "private"

    @model_validator(mode="after")
    def validate_scope(self):
        if self.endpoint_url:
            url = urlsplit(self.endpoint_url)
            if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("Use an HTTP(S) endpoint without credentials, query or fragment")
        permitted = {
            "browser": {"connection"},
            "manager": {"connection", "account"},
            "portal": {"account"},
            "ceph-admin": {"endpoint"},
        }
        if self.resource_kind not in permitted[self.workspace]:
            raise ValueError("Resource kind does not match the selected workspace")
        if self.connection_id and self.resource_kind != "connection":
            raise ValueError("Connection does not match the selected resource kind")
        if self.account_id and self.resource_kind != "account":
            raise ValueError("Account does not match the selected resource kind")
        if self.prefix and not self.bucket:
            raise ValueError("A bucket is required when checking a prefix")
        if self.prefix and self.workspace != "browser":
            raise ValueError("Prefix checks require the Browser workspace")
        if (self.space_name or self.space_id) and self.workspace != "portal":
            raise ValueError("Storage Spaces require the Portal workspace")
        if self.space_id and self.space_name:
            raise ValueError("Choose an existing space or a new space name")
        return self


class OnboardingSave(ApiModel):
    model_config = ConfigDict(extra="forbid")
    draft: OnboardingDraft
    revision: int | None = Field(default=None, gt=0)


class OnboardingApply(ApiModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(gt=0)
    confirmed: Literal[True]
    review_token: str = Field(min_length=64, max_length=64)
    # Never copied into a journey, preview, audit event, response or error.
    access_key: SecretStr | None = None
    secret_key: SecretStr | None = None


class OnboardingAttestation(ApiModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(gt=0)
    check: Literal["usage", "backup", "restore", "updates", "identities", "ownership", "pilot_allowed", "pilot_denied", "isolation"]
    checked: bool
    note: str = Field(default="", max_length=1000)


class OnboardingVerify(ApiModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(gt=0)


class OnboardingOption(ApiModel):
    id: int
    name: str
    endpoint_id: int | None = None
    provider: str | None = None
    is_shared: bool = False


class OnboardingSpaceOption(ApiModel):
    id: str
    name: str
    account_id: int


class OnboardingPreview(ApiModel):
    features: list[str] = Field(default_factory=list)
    changes: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    review_token: str = ""


class OnboardingJourneyOut(ApiModel):
    id: str
    revision: int
    draft: OnboardingDraft
    resources: dict = Field(default_factory=dict)
    evidence: dict = Field(default_factory=dict)
    readiness: dict = Field(default_factory=dict)
    pending_step: str | None = None
    configured: bool = False
    usage_validated: bool = False
    ready: bool = False
    preview: OnboardingPreview
    open_url: str | None = None
    created_at: datetime
    updated_at: datetime


class OnboardingStatus(ApiModel):
    dismissed: bool
    complete: bool
    endpoint_configured: bool
    storage_access_configured: bool
    source: Literal["quickstart", "standard"] = "standard"
    journeys: list[OnboardingJourneyOut] = Field(default_factory=list)
    endpoints: list[OnboardingOption] = Field(default_factory=list)
    accounts: list[OnboardingOption] = Field(default_factory=list)
    connections: list[OnboardingOption] = Field(default_factory=list)
    users: list[OnboardingOption] = Field(default_factory=list)
    spaces: list[OnboardingSpaceOption] = Field(default_factory=list)
    can_configure: bool = False
    actor_id: int = 0
