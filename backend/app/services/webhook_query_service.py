# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import WebhookEndpointNotFoundError
from app.db import WebhookDelivery, WebhookEndpoint, WebhookEndpointSubscription
from app.models.webhook import WebhookDeliveryOut, WebhookEndpointOut
from app.services.webhook_catalog import ALL_WEBHOOK_EVENTS


class WebhookQueryService:
    """Read and serialize configured webhook endpoints and deliveries."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_endpoints(self) -> list[WebhookEndpointOut]:
        rows = self.db.scalars(
            select(WebhookEndpoint).order_by(
                WebhookEndpoint.name.asc(),
                WebhookEndpoint.id.asc(),
            )
        ).all()
        endpoint_ids = [int(row.id) for row in rows]
        latest = self._latest_deliveries(endpoint_ids)
        event_types = self._event_types_by_endpoint(endpoint_ids)
        return [
            self.serialize_endpoint(
                row,
                event_types=event_types.get(int(row.id), []),
                latest_delivery=latest.get(int(row.id)),
            )
            for row in rows
        ]

    def get_endpoint(self, endpoint_id: int) -> WebhookEndpointOut:
        row = self.get_endpoint_record(endpoint_id)
        latest = self._latest_deliveries([int(row.id)])
        return self.serialize_endpoint(
            row,
            event_types=self._event_types_by_endpoint([int(row.id)]).get(
                int(row.id),
                [],
            ),
            latest_delivery=latest.get(int(row.id)),
        )

    def list_deliveries(
        self,
        endpoint_id: int,
        *,
        limit: int = 100,
    ) -> list[WebhookDeliveryOut]:
        self.get_endpoint_record(endpoint_id)
        rows = self.db.scalars(
            select(WebhookDelivery)
            .where(WebhookDelivery.endpoint_id == endpoint_id)
            .order_by(WebhookDelivery.created_at.desc(), WebhookDelivery.id.desc())
            .limit(max(1, min(int(limit), 200)))
        ).all()
        return [self._delivery_out(row) for row in rows]

    def get_endpoint_record(self, endpoint_id: int) -> WebhookEndpoint:
        row = self.db.get(WebhookEndpoint, int(endpoint_id))
        if row is None:
            raise WebhookEndpointNotFoundError("Webhook endpoint not found")
        return row

    def serialize_endpoint(
        self,
        row: WebhookEndpoint,
        *,
        event_types: list[str] | None = None,
        latest_delivery: WebhookDelivery | None = None,
    ) -> WebhookEndpointOut:
        if event_types is None:
            event_types = self._event_types_by_endpoint([int(row.id)]).get(int(row.id), [])
        return WebhookEndpointOut(
            id=int(row.id),
            name=row.name,
            url=row.url,
            enabled=row.enabled,
            event_types=event_types,
            has_signing_secret=bool(row.signing_secret),
            last_delivery=(
                self._delivery_out(latest_delivery)
                if latest_delivery is not None
                else None
            ),
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _event_types_by_endpoint(
        self,
        endpoint_ids: Iterable[int],
    ) -> dict[int, list[str]]:
        ids = sorted({int(endpoint_id) for endpoint_id in endpoint_ids})
        if not ids:
            return {}
        grouped: dict[int, list[str]] = {}
        for endpoint_id, event_type in self.db.execute(
            select(
                WebhookEndpointSubscription.endpoint_id,
                WebhookEndpointSubscription.event_type,
            )
            .where(WebhookEndpointSubscription.endpoint_id.in_(ids))
            .order_by(
                WebhookEndpointSubscription.endpoint_id.asc(),
                WebhookEndpointSubscription.event_type.asc(),
            )
        ):
            grouped.setdefault(int(endpoint_id), []).append(str(event_type))
        return {
            endpoint_id: [ALL_WEBHOOK_EVENTS] if ALL_WEBHOOK_EVENTS in values else values
            for endpoint_id, values in grouped.items()
        }

    def _latest_deliveries(
        self,
        endpoint_ids: Iterable[int],
    ) -> dict[int, WebhookDelivery]:
        ids = sorted({int(endpoint_id) for endpoint_id in endpoint_ids})
        if not ids:
            return {}
        latest_ids = [
            int(delivery_id)
            for delivery_id in self.db.scalars(
                select(func.max(WebhookDelivery.id))
                .where(WebhookDelivery.endpoint_id.in_(ids))
                .group_by(WebhookDelivery.endpoint_id)
            ).all()
            if delivery_id is not None
        ]
        if not latest_ids:
            return {}
        rows = self.db.scalars(
            select(WebhookDelivery).where(WebhookDelivery.id.in_(latest_ids))
        ).all()
        return {int(row.endpoint_id): row for row in rows}

    @staticmethod
    def _delivery_out(row: WebhookDelivery) -> WebhookDeliveryOut:
        return WebhookDeliveryOut(
            id=int(row.id),
            event_type=row.event_type,
            is_test=row.is_test,
            status=row.status,
            attempt_count=int(row.attempt_count),
            last_http_status=row.last_http_status,
            last_error=row.last_error,
            updated_at=row.updated_at,
            delivered_at=row.delivered_at,
        )
