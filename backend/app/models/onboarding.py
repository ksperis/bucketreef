# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, SecretStr, model_validator

from app.models.base import ApiModel


class OnboardingDraft(ApiModel):
    """Secret-free setup intent for the simplified onboarding flow."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[2] = 2
    endpoint_id: int | None = Field(default=None, gt=0)
    endpoint_url: str = Field(default="", max_length=2048)
    region: str = Field(default="", max_length=100)
    force_path_style: bool = True
    manager: bool = False
    portal: bool = False
    private_connection: bool = False
    ceph_admin: bool = False
    supervision: bool = False

    @model_validator(mode="after")
    def validate_endpoint(self):
        if self.endpoint_id and self.endpoint_url:
            raise ValueError("Choose an existing endpoint or enter a new endpoint URL")
        if self.endpoint_url:
            url = urlsplit(self.endpoint_url)
            if (
                url.scheme not in {"http", "https"}
                or not url.hostname
                or url.username
                or url.password
                or url.query
                or url.fragment
            ):
                raise ValueError(
                    "Use an HTTP(S) endpoint without credentials, query or fragment"
                )
        return self

    @property
    def selected_options(self) -> tuple[str, ...]:
        return tuple(
            option
            for option in (
                "manager",
                "portal",
                "private_connection",
                "ceph_admin",
                "supervision",
            )
            if getattr(self, option)
        )


class OnboardingSave(ApiModel):
    model_config = ConfigDict(extra="forbid")
    draft: OnboardingDraft
    revision: int | None = Field(default=None, gt=0)


class OnboardingApply(ApiModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(gt=0)
    confirmed: Literal[True]
    review_token: str = Field(min_length=64, max_length=64)
    # Write-only credentials. They are never copied into draft/progress/audit data.
    admin_access_key: SecretStr | None = None
    admin_secret_key: SecretStr | None = None
    supervision_access_key: SecretStr | None = None
    supervision_secret_key: SecretStr | None = None
    ceph_admin_access_key: SecretStr | None = None
    ceph_admin_secret_key: SecretStr | None = None
    private_access_key: SecretStr | None = None
    private_secret_key: SecretStr | None = None


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
    pending_step: str | None = None
    configured: bool = False
    preview: OnboardingPreview
    links: dict[str, str] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class OnboardingStatus(ApiModel):
    dismissed: bool
    complete: bool
    endpoint_configured: bool
    storage_access_configured: bool
    source: Literal["quickstart", "standard"] = "standard"
    journeys: list[OnboardingJourneyOut] = Field(default_factory=list)
    can_configure: bool = False
    actor_id: int = 0
