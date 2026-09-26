# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.security import EncryptedString
from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow
from sqlalchemy import Boolean, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"
    __table_args__ = (
        UniqueConstraint("name", name="uq_webhook_endpoints_name"),
        Index("ix_webhook_endpoints_enabled_id", "enabled", "id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    url = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=False, server_default="0")
    signing_secret = Column(EncryptedString, nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)

    subscriptions = relationship(
        "WebhookEndpointSubscription",
        back_populates="endpoint",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    deliveries = relationship(
        "WebhookDelivery",
        back_populates="endpoint",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class WebhookEndpointSubscription(Base):
    __tablename__ = "webhook_endpoint_subscriptions"
    __table_args__ = (
        UniqueConstraint("endpoint_id", "event_type", name="uq_webhook_endpoint_subscription"),
        Index("ix_webhook_subscriptions_event_endpoint", "event_type", "endpoint_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    endpoint_id = Column(Integer, ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False)

    endpoint = relationship("WebhookEndpoint", back_populates="subscriptions")


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        UniqueConstraint("delivery_id", name="uq_webhook_deliveries_delivery_id"),
        Index("ix_webhook_deliveries_due", "status", "next_attempt_at", "id"),
        Index("ix_webhook_deliveries_endpoint_created", "endpoint_id", "created_at", "id"),
        Index("ix_webhook_deliveries_event", "event_id", "endpoint_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    delivery_id = Column(String, nullable=False)
    event_id = Column(String, nullable=False, index=True)
    endpoint_id = Column(Integer, ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String, nullable=False, index=True)
    payload_json = Column(Text, nullable=False)
    is_test = Column(Boolean, nullable=False, default=False, server_default="0")
    status = Column(String, nullable=False, default="pending", server_default="pending", index=True)
    attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at = Column(UTCDateTime(), nullable=False, default=utcnow, index=True)
    last_http_status = Column(Integer, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow, index=True)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    delivered_at = Column(UTCDateTime(), nullable=True)

    endpoint = relationship("WebhookEndpoint", back_populates="deliveries")
