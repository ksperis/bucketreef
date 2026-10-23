# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.webhook import (
    WebhookDeliveryOut,
    WebhookEndpointCreated,
    WebhookEndpointOut,
    WebhookTestResponse,
)


def test_webhook_responses_require_complete_canonical_payloads() -> None:
    assert set(WebhookDeliveryOut.model_json_schema()["required"]) == {
        "id",
        "delivery_id",
        "event_id",
        "endpoint_id",
        "event_type",
        "is_test",
        "status",
        "attempt_count",
        "next_attempt_at",
        "last_http_status",
        "last_error",
        "created_at",
        "updated_at",
        "delivered_at",
    }
    assert set(WebhookEndpointOut.model_json_schema()["required"]) == {
        "id",
        "name",
        "url",
        "enabled",
        "event_types",
        "has_signing_secret",
        "last_delivery",
        "created_at",
        "updated_at",
    }
    assert set(WebhookEndpointCreated.model_json_schema()["required"]) == {
        "id",
        "name",
        "url",
        "enabled",
        "event_types",
        "has_signing_secret",
        "last_delivery",
        "created_at",
        "updated_at",
        "signing_secret",
    }
    assert set(WebhookTestResponse.model_json_schema()["required"]) == {
        "delivery_id",
        "status",
    }
