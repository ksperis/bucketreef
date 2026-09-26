# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ast
from dataclasses import replace
from datetime import timedelta
import hashlib
import hmac
import ipaddress
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.db import User, UserRole, WebhookDelivery, WebhookEndpoint
from app.models.webhook import WebhookEndpointPayload
from app.services.audit_policy import should_persist_audit_action
from app.services.audit_service import AuditService
from app.services.operation_lease_service import OperationLeaseService
from app.services.webhook_catalog import KNOWN_WEBHOOK_EVENT_TYPES, MIGRATION_EVENT_TYPE
from app.services.webhook_service import (
    WebhookEventPublisher,
    WebhookService,
    validate_webhook_target_url,
    webhook_runtime_config,
)
from app.services.webhook_worker import WebhookDeliveryWorker
from app.utils.time import utcnow


def _create_endpoint(
    db_session,
    monkeypatch,
    *,
    name: str,
    event_types: list[str],
    enabled: bool = True,
):
    monkeypatch.setattr("app.services.webhook_service.validate_webhook_target_url", lambda *_args, **_kwargs: None)
    return WebhookService(db_session).create_endpoint(
        WebhookEndpointPayload(
            name=name,
            url=f"https://hooks.example.test/{name}",
            enabled=enabled,
            event_types=event_types,
        )
    )


def test_webhook_secret_is_one_time_and_encrypted_at_rest(db_session, monkeypatch):
    created = _create_endpoint(
        db_session,
        monkeypatch,
        name="ops",
        event_types=["*"],
        enabled=False,
    )

    assert created.signing_secret
    assert created.has_signing_secret is True
    raw_secret = db_session.execute(
        text("SELECT signing_secret FROM webhook_endpoints WHERE id = :endpoint_id"),
        {"endpoint_id": created.id},
    ).scalar_one()
    assert raw_secret != created.signing_secret
    assert created.signing_secret not in raw_secret

    listed = WebhookService(db_session).list_endpoints()
    loaded = WebhookService(db_session).get_endpoint(created.id)
    assert listed[0].has_signing_secret is True
    assert not hasattr(listed[0], "signing_secret")
    assert not hasattr(loaded, "signing_secret")


def test_webhook_event_publisher_matches_wildcard_and_exact_subscriptions(db_session, monkeypatch):
    wildcard = _create_endpoint(db_session, monkeypatch, name="all", event_types=["*"])
    exact = _create_endpoint(
        db_session,
        monkeypatch,
        name="audit",
        event_types=["audit.admin.update_ui_user"],
    )
    _create_endpoint(db_session, monkeypatch, name="migration", event_types=[MIGRATION_EVENT_TYPE])

    delivery_ids = WebhookEventPublisher(db_session).publish_event(
        event_type="audit.admin.update_ui_user",
        data={"entity_id": "42"},
        commit=True,
    )

    deliveries = db_session.query(WebhookDelivery).filter(WebhookDelivery.delivery_id.in_(delivery_ids)).all()
    assert len(delivery_ids) == 2
    assert {delivery.endpoint_id for delivery in deliveries} == {wildcard.id, exact.id}
    assert len({delivery.event_id for delivery in deliveries}) == 1
    assert all(delivery.status == "pending" for delivery in deliveries)


def test_disabled_endpoint_is_skipped_for_production_events_but_accepts_test(db_session, monkeypatch):
    created = _create_endpoint(db_session, monkeypatch, name="disabled", event_types=["*"], enabled=False)

    WebhookEventPublisher(db_session).publish_event(
        event_type="audit.admin.update_ui_user",
        data={},
        commit=True,
    )
    assert db_session.query(WebhookDelivery).count() == 0

    queued = WebhookService(db_session).enqueue_test(created.id)
    delivery = db_session.query(WebhookDelivery).filter_by(delivery_id=queued.delivery_id).one()
    assert delivery.is_test is True
    assert delivery.status == "pending"


def test_endpoint_without_secret_cannot_be_enabled(db_session, monkeypatch):
    endpoint = WebhookEndpoint(
        name="legacy migration webhook",
        url="https://hooks.example.test/legacy",
        enabled=False,
        signing_secret=None,
    )
    db_session.add(endpoint)
    db_session.commit()
    monkeypatch.setattr("app.services.webhook_service.validate_webhook_target_url", lambda *_args, **_kwargs: None)

    with pytest.raises(ValueError, match="Rotate the signing secret"):
        WebhookService(db_session).update_endpoint(
            endpoint.id,
            WebhookEndpointPayload(
                name=endpoint.name,
                url=endpoint.url,
                enabled=True,
                event_types=[MIGRATION_EVENT_TYPE],
            ),
        )


def test_audit_service_queues_control_plane_event_but_excludes_object_data_plane(db_session, monkeypatch):
    endpoint = _create_endpoint(db_session, monkeypatch, name="audit-all", event_types=["*"])

    AuditService(db_session).record_action(
        user=None,
        user_email="admin@example.test",
        user_role="ui_superadmin",
        scope="admin",
        action="update_ui_user",
        entity_type="user",
        entity_id="7",
    )
    delivery = db_session.query(WebhookDelivery).filter_by(endpoint_id=endpoint.id).one()
    assert delivery.event_type == "audit.admin.update_ui_user"

    AuditService(db_session).record_action(
        user=None,
        user_email="admin@example.test",
        user_role="ui_superadmin",
        scope="browser",
        action="upload_object",
        entity_type="object",
        entity_id="secret-file.bin",
    )
    assert db_session.query(WebhookDelivery).filter_by(endpoint_id=endpoint.id).count() == 1


def test_literal_persisted_audit_actions_are_present_in_webhook_catalog():
    app_root = Path(__file__).resolve().parents[1] / "app"
    missing: list[str] = []

    for path in app_root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            function_name = (
                node.func.attr
                if isinstance(node.func, ast.Attribute)
                else node.func.id
                if isinstance(node.func, ast.Name)
                else ""
            )
            if function_name != "record_action":
                continue
            keywords = {keyword.arg: keyword.value for keyword in node.keywords if keyword.arg}

            def literal(name: str) -> str | None:
                value = keywords.get(name)
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    return value.value
                return None

            scope = literal("scope")
            action = literal("action")
            if scope and action and should_persist_audit_action(action):
                event_type = f"audit.{scope}.{action}"
                if event_type not in KNOWN_WEBHOOK_EVENT_TYPES:
                    missing.append(f"{event_type} ({path.relative_to(app_root.parent)}:{node.lineno})")

    assert missing == []


def test_transactional_webhook_failure_rolls_back_only_webhook_savepoint(db_session, monkeypatch):
    endpoint = _create_endpoint(db_session, monkeypatch, name="savepoint", event_types=["*"])
    business_user = User(
        email="business-state@example.test",
        full_name="Business State",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(business_user)
    publisher = WebhookEventPublisher(db_session)

    def fail_publish(**_kwargs):
        now = utcnow()
        db_session.add(
            WebhookDelivery(
                delivery_id="savepoint-rollback-delivery",
                event_id="savepoint-rollback-event",
                endpoint_id=endpoint.id,
                event_type="system.endpoint_health.changed",
                payload_json="{}",
                is_test=False,
                status="pending",
                attempt_count=0,
                next_attempt_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        db_session.flush()
        raise RuntimeError("webhook queue write failed")

    monkeypatch.setattr(publisher, "publish_event", fail_publish)
    with pytest.raises(RuntimeError, match="webhook queue write failed"):
        publisher.publish_event_in_current_transaction(
            event_type="system.endpoint_health.changed",
            data={"endpoint_id": 1},
        )

    db_session.commit()
    assert business_user.id is not None
    assert db_session.get(User, business_user.id) is not None
    assert db_session.query(WebhookDelivery).filter_by(delivery_id="savepoint-rollback-delivery").count() == 0


def test_production_webhook_target_requires_https_and_explicit_allowlist(monkeypatch):
    settings = Settings(
        _env_file=None,
        app_env="production",
        webhook_allowed_hosts=[],
        webhook_allow_private_targets=False,
    )
    with pytest.raises(ValueError, match="host is not allowed by policy"):
        validate_webhook_target_url("https://hooks.example.test/events", settings)

    settings = Settings(
        _env_file=None,
        app_env="production",
        webhook_allowed_hosts=["hooks.example.test"],
        webhook_allow_private_targets=False,
    )
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )
    validate_webhook_target_url("https://hooks.example.test/events", settings)
    with pytest.raises(ValueError, match="valid https URL"):
        validate_webhook_target_url("http://hooks.example.test/events", settings)


def test_webhook_runtime_lease_always_exceeds_http_timeout():
    runtime = webhook_runtime_config(
        Settings(
            _env_file=None,
            webhook_timeout_seconds=45.2,
            webhook_worker_lease_seconds=15,
        )
    )
    assert runtime.timeout_seconds == 45.2
    assert runtime.lease_seconds >= 56


def test_worker_signs_exact_body_and_marks_success(db_session, monkeypatch):
    created = _create_endpoint(
        db_session,
        monkeypatch,
        name="signed",
        event_types=["audit.admin.update_ui_user"],
    )
    delivery_ids = WebhookEventPublisher(db_session).publish_event(
        event_type="audit.admin.update_ui_user",
        data={"value": "a b", "count": 2},
        commit=True,
    )
    delivery = db_session.query(WebhookDelivery).filter_by(delivery_id=delivery_ids[0]).one()
    session_factory = sessionmaker(bind=db_session.get_bind())
    worker = WebhookDeliveryWorker(session_factory)

    monkeypatch.setattr("app.services.webhook_worker.validate_webhook_target_url", lambda *_args, **_kwargs: None)
    with patch("app.services.webhook_worker.requests.post") as post:
        post.return_value = SimpleNamespace(status_code=204, headers={})
        worker._deliver_one(delivery.id)

    assert post.call_count == 1
    _args, kwargs = post.call_args
    body = kwargs["data"]
    headers = kwargs["headers"]
    expected = hmac.new(
        created.signing_secret.encode("utf-8"),
        headers["X-BucketReef-Timestamp"].encode("ascii") + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    assert headers["X-BucketReef-Signature"] == f"v1={expected}"
    assert headers["X-BucketReef-Delivery"] == delivery.delivery_id
    assert headers["X-BucketReef-Event"] == delivery.event_type
    assert kwargs["allow_redirects"] is False

    db_session.expire_all()
    delivered = db_session.get(WebhookDelivery, delivery.id)
    assert delivered.status == "delivered"
    assert delivered.attempt_count == 1
    assert delivered.last_http_status == 204


def test_worker_retries_429_with_retry_after_then_fails_at_attempt_limit(db_session, monkeypatch):
    _create_endpoint(db_session, monkeypatch, name="retry", event_types=["audit.admin.update_ui_user"])
    delivery_ids = WebhookEventPublisher(db_session).publish_event(
        event_type="audit.admin.update_ui_user",
        data={},
        commit=True,
    )
    delivery = db_session.query(WebhookDelivery).filter_by(delivery_id=delivery_ids[0]).one()
    session_factory = sessionmaker(bind=db_session.get_bind())
    worker = WebhookDeliveryWorker(session_factory)
    worker._runtime = replace(
        worker._runtime,
        max_attempts=2,
        retry_initial_seconds=30,
        retry_max_seconds=3600,
    )
    monkeypatch.setattr("app.services.webhook_worker.validate_webhook_target_url", lambda *_args, **_kwargs: None)

    before = utcnow()
    with patch("app.services.webhook_worker.requests.post") as post:
        post.return_value = SimpleNamespace(status_code=429, headers={"Retry-After": "120"})
        worker._deliver_one(delivery.id)

    db_session.expire_all()
    retrying = db_session.get(WebhookDelivery, delivery.id)
    assert retrying.status == "retrying"
    assert retrying.attempt_count == 1
    assert retrying.next_attempt_at >= before + timedelta(seconds=119)

    with patch("app.services.webhook_worker.requests.post") as post:
        post.return_value = SimpleNamespace(status_code=503, headers={})
        worker._deliver_one(delivery.id)

    db_session.expire_all()
    failed = db_session.get(WebhookDelivery, delivery.id)
    assert failed.status == "failed"
    assert failed.attempt_count == 2
    assert failed.last_http_status == 503


def test_worker_dispatches_delivery_persisted_before_worker_creation(db_session, monkeypatch):
    _create_endpoint(db_session, monkeypatch, name="restart", event_types=["audit.admin.update_ui_user"])
    delivery_ids = WebhookEventPublisher(db_session).publish_event(
        event_type="audit.admin.update_ui_user",
        data={"after": "restart"},
        commit=True,
    )
    session_factory = sessionmaker(bind=db_session.get_bind())
    worker = WebhookDeliveryWorker(session_factory)
    monkeypatch.setattr("app.services.webhook_worker.validate_webhook_target_url", lambda *_args, **_kwargs: None)

    with patch("app.services.webhook_worker.requests.post") as post:
        post.return_value = SimpleNamespace(status_code=200, headers={})
        assert worker._dispatch_due() is True

    db_session.expire_all()
    delivery = db_session.query(WebhookDelivery).filter_by(delivery_id=delivery_ids[0]).one()
    assert delivery.status == "delivered"
    assert delivery.attempt_count == 1


def test_global_webhook_lease_allows_only_one_dispatch_owner(db_session):
    session_factory = sessionmaker(bind=db_session.get_bind())
    with session_factory() as first_db, session_factory() as second_db:
        first_service = OperationLeaseService(first_db)
        second_service = OperationLeaseService(second_db)
        first = first_service.acquire("webhooks:dispatch", ttl_seconds=60, owner="worker-one")
        assert first is not None
        assert second_service.acquire("webhooks:dispatch", ttl_seconds=60, owner="worker-two") is None

        first_service.release(first)
        second = second_service.acquire("webhooks:dispatch", ttl_seconds=60, owner="worker-two")
        assert second is not None
        second_service.release(second)


def test_worker_retention_purges_terminal_deliveries_only(db_session, monkeypatch):
    endpoint = _create_endpoint(db_session, monkeypatch, name="retention", event_types=["*"])
    old = utcnow() - timedelta(days=2)
    rows = [
        WebhookDelivery(
            delivery_id="terminal-old",
            event_id="event-terminal-old",
            endpoint_id=endpoint.id,
            event_type="audit.admin.update_ui_user",
            payload_json="{}",
            is_test=False,
            status="delivered",
            attempt_count=1,
            next_attempt_at=old,
            created_at=old,
            updated_at=old,
            delivered_at=old,
        ),
        WebhookDelivery(
            delivery_id="pending-old",
            event_id="event-pending-old",
            endpoint_id=endpoint.id,
            event_type="audit.admin.update_ui_user",
            payload_json="{}",
            is_test=False,
            status="pending",
            attempt_count=0,
            next_attempt_at=old,
            created_at=old,
            updated_at=old,
        ),
    ]
    db_session.add_all(rows)
    db_session.commit()
    worker = WebhookDeliveryWorker(sessionmaker(bind=db_session.get_bind()))
    worker._runtime = replace(worker._runtime, retention_days=1)

    worker._purge_if_due()

    db_session.expire_all()
    assert db_session.query(WebhookDelivery).filter_by(delivery_id="terminal-old").count() == 0
    assert db_session.query(WebhookDelivery).filter_by(delivery_id="pending-old").count() == 1
