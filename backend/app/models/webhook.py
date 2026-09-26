# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator

from app.models.base import ApiModel


def _normalize_event_types(values: list[str] | None) -> list[str]:
    normalized: list[str] = []
    for raw in values or []:
        value = str(raw or "").strip()
        if value and value not in normalized:
            normalized.append(value)
    if "*" in normalized:
        return ["*"]
    return normalized


class WebhookEndpointPayload(ApiModel):
    name: str
    url: str
    enabled: bool = False
    event_types: list[str] = Field(default_factory=lambda: ["*"])

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value: object) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("name is required")
        if len(text) > 160:
            raise ValueError("name must be 160 characters or fewer")
        return text

    @field_validator("url", mode="before")
    @classmethod
    def normalize_url(cls, value: object) -> str:
        text = str(value or "").strip()
        parsed = urlparse(text)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be a valid http(s) URL")
        if parsed.username or parsed.password:
            raise ValueError("url must not contain embedded credentials")
        return text

    @field_validator("event_types", mode="before")
    @classmethod
    def normalize_event_types(cls, value: object) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("event_types must be a list")
        return _normalize_event_types(value)

    @model_validator(mode="after")
    def validate_events(self):
        if not self.event_types:
            raise ValueError("Select at least one webhook event")
        return self


class WebhookDeliveryOut(ApiModel):
    id: int
    delivery_id: str
    event_id: str
    endpoint_id: int
    event_type: str
    is_test: bool
    status: Literal["pending", "retrying", "delivered", "failed"]
    attempt_count: int
    next_attempt_at: datetime
    last_http_status: int | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime
    delivered_at: datetime | None = None


class WebhookEndpointOut(ApiModel):
    id: int
    name: str
    url: str
    enabled: bool
    event_types: list[str]
    has_signing_secret: bool
    last_delivery: WebhookDeliveryOut | None = None
    created_at: datetime
    updated_at: datetime


class WebhookEndpointCreated(WebhookEndpointOut):
    signing_secret: str


class WebhookSecretRotation(ApiModel):
    endpoint_id: int
    signing_secret: str


class WebhookEventDefinition(ApiModel):
    type: str
    category: str
    label: str
    description: str


class WebhookTestResponse(ApiModel):
    delivery_id: str
    status: str = "queued"
