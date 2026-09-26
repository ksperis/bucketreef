# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
import math
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable
from urllib.parse import urlparse

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.runtime_surfaces import runtime_surface_enabled
from app.core.sensitive_data import sanitize_audit_metadata
from app.db import WebhookDelivery, WebhookEndpoint, WebhookEndpointSubscription
from app.models.webhook import (
    WebhookDeliveryOut,
    WebhookEndpointCreated,
    WebhookEndpointOut,
    WebhookEndpointPayload,
    WebhookSecretRotation,
    WebhookTestResponse,
)
from app.services.webhook_catalog import (
    ALL_WEBHOOK_EVENTS,
    KNOWN_WEBHOOK_EVENT_TYPES,
    WEBHOOK_TEST_EVENT_TYPE,
)
from app.utils.network_targets import validate_outbound_url
from app.utils.time import utcnow

logger = logging.getLogger(__name__)
_WEBHOOK_DISPATCH_PROFILES = {"full", "admin", "admin-no-ceph-admin"}


@dataclass(frozen=True)
class WebhookRuntimeConfig:
    timeout_seconds: float
    allow_private_targets: bool
    allowed_hosts: set[str]
    workers: int
    max_attempts: int
    retry_initial_seconds: int
    retry_max_seconds: int
    retention_days: int
    poll_interval_seconds: float
    lease_seconds: int


def webhook_dispatcher_enabled(settings: Settings | None = None) -> bool:
    """Return whether this backend runtime is allowed to deliver webhooks.

    Webhook events may be queued by any backend sharing the application
    database, but outbound delivery belongs to an Admin-capable runtime. This
    keeps split user and high-security Ceph Admin pools from taking the global
    dispatcher lease or becoming the network egress point for Admin-managed
    integrations.
    """

    settings = settings or get_settings()
    return bool(
        settings.webhook_worker_enabled
        and settings.deployment_profile in _WEBHOOK_DISPATCH_PROFILES
        and runtime_surface_enabled(settings, "admin")
    )


def _field_was_set(settings: Settings, field: str) -> bool:
    return field in getattr(settings, "model_fields_set", set())


def webhook_runtime_config(settings: Settings | None = None) -> WebhookRuntimeConfig:
    settings = settings or get_settings()

    def prefer(new_field: str, legacy_field: str):
        if _field_was_set(settings, new_field):
            return getattr(settings, new_field)
        if _field_was_set(settings, legacy_field):
            return getattr(settings, legacy_field)
        return getattr(settings, new_field)

    allowed_hosts = prefer("webhook_allowed_hosts", "bucket_migration_webhook_allowed_hosts")
    allow_private_targets = prefer(
        "webhook_allow_private_targets",
        "bucket_migration_webhook_allow_private_targets",
    )
    timeout_seconds = prefer(
        "webhook_timeout_seconds",
        "bucket_migration_webhook_timeout_seconds",
    )
    effective_timeout_seconds = max(0.1, float(timeout_seconds or 5.0))
    workers = prefer("webhook_workers", "bucket_migration_webhook_workers")
    return WebhookRuntimeConfig(
        timeout_seconds=effective_timeout_seconds,
        allow_private_targets=bool(allow_private_targets),
        allowed_hosts={
            str(host or "").strip().lower().rstrip(".")
            for host in (allowed_hosts or [])
            if str(host or "").strip()
        },
        workers=max(1, min(int(workers or 4), 16)),
        max_attempts=max(1, min(int(settings.webhook_max_attempts or 8), 32)),
        retry_initial_seconds=max(1, int(settings.webhook_retry_initial_seconds or 30)),
        retry_max_seconds=max(1, int(settings.webhook_retry_max_seconds or 3600)),
        retention_days=max(0, int(settings.webhook_retention_days or 0)),
        poll_interval_seconds=max(0.2, float(settings.webhook_poll_interval_seconds or 1.0)),
        lease_seconds=max(
            15,
            int(settings.webhook_worker_lease_seconds or 120),
            math.ceil(effective_timeout_seconds) + 10,
        ),
    )


def validate_webhook_target_url(url: str, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    runtime = webhook_runtime_config(settings)
    production = settings.app_env == "production"
    allow_http = not production or runtime.allow_private_targets
    validate_outbound_url(
        url,
        field_name="webhook URL",
        allowed_schemes=("http", "https") if allow_http else ("https",),
        scheme_label="http(s)" if allow_http else "https",
        allowed_hosts=runtime.allowed_hosts if production else (runtime.allowed_hosts or None),
        allow_private_targets=runtime.allow_private_targets,
        private_target_hint="; set WEBHOOK_ALLOW_PRIVATE_TARGETS=true to allow it",
    )


def webhook_target_hostname(url: str) -> str:
    return str(urlparse(url).hostname or "").strip().lower().rstrip(".")


def _new_signing_secret() -> str:
    return secrets.token_urlsafe(32)


def _event_payload_json(
    *,
    event_id: str,
    event_type: str,
    occurred_at: datetime,
    data: dict[str, Any],
) -> str:
    safe_data = sanitize_audit_metadata(data)
    return json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "version": 1,
            "occurred_at": occurred_at.isoformat(),
            "data": safe_data,
        },
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


class WebhookService:
    def __init__(self, db: Session, *, settings: Settings | None = None) -> None:
        self.db = db
        self.settings = settings or get_settings()

    def list_endpoints(self) -> list[WebhookEndpointOut]:
        rows = self.db.query(WebhookEndpoint).order_by(WebhookEndpoint.name.asc(), WebhookEndpoint.id.asc()).all()
        latest = self._latest_deliveries([int(row.id) for row in rows])
        return [self._endpoint_out(row, latest_delivery=latest.get(int(row.id))) for row in rows]

    def get_endpoint(self, endpoint_id: int) -> WebhookEndpointOut:
        row = self._require_endpoint(endpoint_id)
        latest = self._latest_deliveries([int(row.id)])
        return self._endpoint_out(row, latest_delivery=latest.get(int(row.id)))

    def create_endpoint(self, payload: WebhookEndpointPayload) -> WebhookEndpointCreated:
        validate_webhook_target_url(payload.url, self.settings)
        event_types = self._validate_event_types(payload.event_types)
        secret = _new_signing_secret()
        row = WebhookEndpoint(
            name=payload.name,
            url=payload.url,
            enabled=bool(payload.enabled),
            signing_secret=secret,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        try:
            self.db.flush()
            self._replace_subscriptions(row, event_types)
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ValueError("A webhook endpoint with this name already exists") from exc
        self.db.refresh(row)
        out = self._endpoint_out(row)
        return WebhookEndpointCreated(**out.model_dump(), signing_secret=secret)

    def update_endpoint(self, endpoint_id: int, payload: WebhookEndpointPayload) -> WebhookEndpointOut:
        row = self._require_endpoint(endpoint_id)
        validate_webhook_target_url(payload.url, self.settings)
        event_types = self._validate_event_types(payload.event_types)
        if payload.enabled and not row.signing_secret:
            raise ValueError("Rotate the signing secret before enabling this endpoint")
        row.name = payload.name
        row.url = payload.url
        row.enabled = bool(payload.enabled)
        row.updated_at = utcnow()
        self._replace_subscriptions(row, event_types)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ValueError("A webhook endpoint with this name already exists") from exc
        self.db.refresh(row)
        return self._endpoint_out(row)

    def delete_endpoint(self, endpoint_id: int) -> None:
        row = self._require_endpoint(endpoint_id)
        self.db.delete(row)
        self.db.commit()

    def rotate_secret(self, endpoint_id: int) -> WebhookSecretRotation:
        row = self._require_endpoint(endpoint_id)
        secret = _new_signing_secret()
        row.signing_secret = secret
        row.updated_at = utcnow()
        self.db.commit()
        return WebhookSecretRotation(endpoint_id=row.id, signing_secret=secret)

    def enqueue_test(self, endpoint_id: int) -> WebhookTestResponse:
        row = self._require_endpoint(endpoint_id)
        if not row.signing_secret:
            raise ValueError("Rotate the signing secret before sending a test delivery")
        validate_webhook_target_url(row.url, self.settings)
        ids = WebhookEventPublisher(self.db).publish_event(
            event_type=WEBHOOK_TEST_EVENT_TYPE,
            data={
                "message": "BucketReef webhook test delivery",
                "endpoint_id": row.id,
                "endpoint_name": row.name,
            },
            endpoint_ids=[row.id],
            is_test=True,
            commit=True,
        )
        if not ids:
            raise RuntimeError("Unable to queue webhook test delivery")
        return WebhookTestResponse(delivery_id=ids[0])

    def list_deliveries(self, endpoint_id: int, *, limit: int = 100) -> list[WebhookDeliveryOut]:
        self._require_endpoint(endpoint_id)
        rows = (
            self.db.query(WebhookDelivery)
            .filter(WebhookDelivery.endpoint_id == endpoint_id)
            .order_by(WebhookDelivery.created_at.desc(), WebhookDelivery.id.desc())
            .limit(max(1, min(int(limit), 200)))
            .all()
        )
        return [self._delivery_out(row) for row in rows]

    def _require_endpoint(self, endpoint_id: int) -> WebhookEndpoint:
        row = self.db.get(WebhookEndpoint, int(endpoint_id))
        if row is None:
            raise LookupError("Webhook endpoint not found")
        return row

    def _validate_event_types(self, event_types: Iterable[str]) -> list[str]:
        normalized = []
        for raw in event_types:
            value = str(raw or "").strip()
            if value and value not in normalized:
                normalized.append(value)
        if ALL_WEBHOOK_EVENTS in normalized:
            return [ALL_WEBHOOK_EVENTS]
        if not normalized:
            raise ValueError("Select at least one webhook event")
        unknown = sorted(set(normalized) - KNOWN_WEBHOOK_EVENT_TYPES)
        if unknown:
            raise ValueError(f"Unknown webhook event type: {unknown[0]}")
        return normalized

    def _replace_subscriptions(self, row: WebhookEndpoint, event_types: list[str]) -> None:
        if row.id is None:
            self.db.flush()
        self.db.query(WebhookEndpointSubscription).filter(
            WebhookEndpointSubscription.endpoint_id == row.id
        ).delete(synchronize_session=False)
        for event_type in event_types:
            self.db.add(
                WebhookEndpointSubscription(
                    endpoint_id=row.id,
                    event_type=event_type,
                )
            )

    @staticmethod
    def _event_types(row: WebhookEndpoint) -> list[str]:
        values = sorted({str(item.event_type) for item in row.subscriptions})
        return [ALL_WEBHOOK_EVENTS] if ALL_WEBHOOK_EVENTS in values else values

    def _latest_deliveries(self, endpoint_ids: Iterable[int]) -> dict[int, WebhookDelivery]:
        ids = sorted({int(endpoint_id) for endpoint_id in endpoint_ids})
        if not ids:
            return {}
        latest_ids = [
            int(row[0])
            for row in (
                self.db.query(func.max(WebhookDelivery.id))
                .filter(WebhookDelivery.endpoint_id.in_(ids))
                .group_by(WebhookDelivery.endpoint_id)
                .all()
            )
            if row[0] is not None
        ]
        if not latest_ids:
            return {}
        rows = self.db.query(WebhookDelivery).filter(WebhookDelivery.id.in_(latest_ids)).all()
        return {int(row.endpoint_id): row for row in rows}

    def _endpoint_out(
        self,
        row: WebhookEndpoint,
        *,
        latest_delivery: WebhookDelivery | None = None,
    ) -> WebhookEndpointOut:
        return WebhookEndpointOut(
            id=int(row.id),
            name=row.name,
            url=row.url,
            enabled=bool(row.enabled),
            event_types=self._event_types(row),
            has_signing_secret=bool(row.signing_secret),
            last_delivery=(self._delivery_out(latest_delivery) if latest_delivery is not None else None),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _delivery_out(row: WebhookDelivery) -> WebhookDeliveryOut:
        return WebhookDeliveryOut(
            id=int(row.id),
            delivery_id=row.delivery_id,
            event_id=row.event_id,
            endpoint_id=int(row.endpoint_id),
            event_type=row.event_type,
            is_test=bool(row.is_test),
            status=row.status,
            attempt_count=int(row.attempt_count or 0),
            next_attempt_at=row.next_attempt_at,
            last_http_status=row.last_http_status,
            last_error=row.last_error,
            created_at=row.created_at,
            updated_at=row.updated_at,
            delivered_at=row.delivered_at,
        )


class WebhookEventPublisher:
    def __init__(self, db: Session) -> None:
        self.db = db

    def publish_audit_event(
        self,
        *,
        scope: str,
        action: str,
        user_email: str,
        user_role: str,
        entity_type: str | None,
        entity_id: str | None,
        account_id: int | None,
        account_name: str | None,
        status: str,
        message: str | None,
        metadata: dict[str, Any] | None,
        occurred_at: datetime | None = None,
        commit: bool = True,
    ) -> list[str]:
        return self.publish_event(
            event_type=f"audit.{scope}.{action}",
            occurred_at=occurred_at,
            data={
                "actor": {
                    "email": user_email,
                    "role": user_role,
                },
                "scope": scope,
                "action": action,
                "target": {
                    "type": entity_type,
                    "id": entity_id,
                },
                "account": {
                    "id": account_id,
                    "name": account_name,
                }
                if account_id is not None or account_name
                else None,
                "status": status,
                "message": message,
                "metadata": metadata,
            },
            commit=commit,
        )

    def publish_event(
        self,
        *,
        event_type: str,
        data: dict[str, Any],
        occurred_at: datetime | None = None,
        endpoint_ids: Iterable[int] | None = None,
        is_test: bool = False,
        commit: bool = True,
    ) -> list[str]:
        occurred_at = occurred_at or utcnow()
        event_id = str(uuid.uuid4())
        payload_json = _event_payload_json(
            event_id=event_id,
            event_type=event_type,
            occurred_at=occurred_at,
            data=data,
        )
        query = self.db.query(WebhookEndpoint)
        forced_ids = sorted({int(item) for item in endpoint_ids or [] if int(item) > 0})
        if forced_ids:
            query = query.filter(WebhookEndpoint.id.in_(forced_ids))
        else:
            query = (
                query.join(
                    WebhookEndpointSubscription,
                    WebhookEndpointSubscription.endpoint_id == WebhookEndpoint.id,
                )
                .filter(
                    WebhookEndpoint.enabled.is_(True),
                    WebhookEndpoint.signing_secret.is_not(None),
                    or_(
                        WebhookEndpointSubscription.event_type == ALL_WEBHOOK_EVENTS,
                        WebhookEndpointSubscription.event_type == event_type,
                    ),
                )
                .distinct()
            )
        endpoint_rows = query.order_by(WebhookEndpoint.id.asc()).all()
        delivery_ids: list[str] = []
        for endpoint in endpoint_rows:
            if not forced_ids and (not endpoint.enabled or not endpoint.signing_secret):
                continue
            delivery_id = str(uuid.uuid4())
            self.db.add(
                WebhookDelivery(
                    delivery_id=delivery_id,
                    event_id=event_id,
                    endpoint_id=int(endpoint.id),
                    event_type=event_type,
                    payload_json=payload_json,
                    is_test=bool(is_test),
                    status="pending",
                    attempt_count=0,
                    next_attempt_at=occurred_at,
                    created_at=occurred_at,
                    updated_at=occurred_at,
                )
            )
            delivery_ids.append(delivery_id)
        if commit and delivery_ids:
            try:
                self.db.commit()
            except SQLAlchemyError:
                self.db.rollback()
                raise
        return delivery_ids

    def publish_event_in_current_transaction(
        self,
        *,
        event_type: str,
        data: dict[str, Any],
        occurred_at: datetime | None = None,
    ) -> list[str]:
        """Queue an event without letting a webhook write poison the caller transaction.

        The nested transaction keeps the delivery durable with the surrounding
        business mutation while allowing the caller to catch and ignore a
        webhook-only database failure. SQLAlchemy flushes existing business
        state before opening the savepoint, so rolling the savepoint back does
        not discard the mutation that triggered the notification.
        """

        with self.db.begin_nested():
            return self.publish_event(
                event_type=event_type,
                data=data,
                occurred_at=occurred_at,
                commit=False,
            )
