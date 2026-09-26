# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import hashlib
import hmac
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from email.utils import parsedate_to_datetime
from typing import Optional

import requests
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.sensitive_data import sanitize_error_detail
from app.db import WebhookDelivery, WebhookEndpoint
from app.services.operation_lease_service import OperationLeaseService, generate_operation_owner
from app.services.webhook_service import validate_webhook_target_url, webhook_runtime_config
from app.utils.time import utcnow

logger = logging.getLogger(__name__)

WEBHOOK_DISPATCH_OPERATION = "webhooks:dispatch"
_TERMINAL_STATUSES = ("delivered", "failed")
_RETRYABLE_HTTP = {408, 425, 429}


class WebhookDeliveryWorker:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory
        self._settings = get_settings()
        self._runtime = webhook_runtime_config(self._settings)
        self._owner = generate_operation_owner("webhook-worker")
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._lock = threading.Lock()
        self._last_purge_at = None

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._wake_event.clear()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="webhook-delivery-worker",
                daemon=True,
            )
            self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        with self._lock:
            self._stop_event.set()
            self._wake_event.set()
            thread = self._thread
        if thread and thread.is_alive():
            thread.join(timeout=timeout)

    def wake_up(self) -> None:
        self._wake_event.set()

    def _run_loop(self) -> None:
        last_lease = None
        try:
            while not self._stop_event.is_set():
                processed = False
                try:
                    with self._session_factory() as db:
                        lease = OperationLeaseService(db).acquire(
                            WEBHOOK_DISPATCH_OPERATION,
                            ttl_seconds=self._runtime.lease_seconds,
                            owner=self._owner,
                            lease_context={"source": "webhook-worker"},
                        )
                    if lease is not None:
                        last_lease = lease
                        processed = self._dispatch_due()
                        self._purge_if_due()
                except Exception:
                    logger.exception("Webhook worker iteration failed")
                wait_seconds = 0.05 if processed else self._runtime.poll_interval_seconds
                self._wake_event.wait(timeout=wait_seconds)
                self._wake_event.clear()
        finally:
            if last_lease is not None:
                try:
                    with self._session_factory() as db:
                        OperationLeaseService(db).release(last_lease)
                except Exception:
                    logger.exception("Failed to release webhook dispatcher lease")

    def _dispatch_due(self) -> bool:
        now = utcnow()
        with self._session_factory() as db:
            ids = [
                int(row[0])
                for row in (
                    db.query(WebhookDelivery.id)
                    .filter(
                        WebhookDelivery.status.in_(("pending", "retrying")),
                        WebhookDelivery.next_attempt_at <= now,
                    )
                    .order_by(WebhookDelivery.next_attempt_at.asc(), WebhookDelivery.id.asc())
                    .limit(self._runtime.workers)
                    .all()
                )
            ]
        if not ids:
            return False
        if len(ids) == 1:
            self._deliver_one(ids[0])
            return True
        with ThreadPoolExecutor(
            max_workers=self._runtime.workers,
            thread_name_prefix="webhook-delivery",
        ) as executor:
            list(executor.map(self._deliver_one, ids))
        return True

    def _deliver_one(self, delivery_id: int) -> None:
        with self._session_factory() as db:
            delivery = db.get(WebhookDelivery, delivery_id)
            if delivery is None or delivery.status not in {"pending", "retrying"}:
                return
            endpoint = db.get(WebhookEndpoint, delivery.endpoint_id)
            if endpoint is None:
                return
            if (not endpoint.enabled and not delivery.is_test) or not endpoint.signing_secret:
                self._fail_terminal(
                    delivery,
                    "Webhook endpoint is disabled or has no signing secret",
                )
                db.commit()
                return

            try:
                validate_webhook_target_url(endpoint.url, self._settings)
            except ValueError as exc:
                self._fail_terminal(delivery, str(exc))
                db.commit()
                return

            body = delivery.payload_json.encode("utf-8")
            timestamp = str(int(utcnow().timestamp()))
            signature = hmac.new(
                endpoint.signing_secret.encode("utf-8"),
                timestamp.encode("ascii") + b"." + body,
                hashlib.sha256,
            ).hexdigest()
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "bucketreef-webhook/1.0",
                "X-BucketReef-Event": delivery.event_type,
                "X-BucketReef-Delivery": delivery.delivery_id,
                "X-BucketReef-Timestamp": timestamp,
                "X-BucketReef-Signature": f"v1={signature}",
            }

            try:
                response = requests.post(
                    endpoint.url,
                    data=body,
                    headers=headers,
                    timeout=self._runtime.timeout_seconds,
                    allow_redirects=False,
                )
            except requests.RequestException as exc:
                self._retry_or_fail(delivery, error=str(exc))
                db.commit()
                return
            except Exception as exc:  # noqa: BLE001
                self._retry_or_fail(delivery, error=str(exc))
                db.commit()
                return

            status_code = int(getattr(response, "status_code", 0) or 0)
            delivery.last_http_status = status_code or None
            if 200 <= status_code < 300:
                now = utcnow()
                delivery.status = "delivered"
                delivery.attempt_count = int(delivery.attempt_count or 0) + 1
                delivery.last_error = None
                delivery.delivered_at = now
                delivery.updated_at = now
                db.commit()
                return

            retryable = (
                status_code in _RETRYABLE_HTTP
                or status_code == 503
                or status_code >= 500
            )
            if retryable:
                retry_after = self._retry_after_seconds(response.headers.get("Retry-After"))
                self._retry_or_fail(
                    delivery,
                    error=f"HTTP {status_code}",
                    retry_after_seconds=retry_after,
                )
            else:
                delivery.attempt_count = int(delivery.attempt_count or 0) + 1
                self._fail_terminal(delivery, f"HTTP {status_code}")
            db.commit()

    def _retry_or_fail(
        self,
        delivery: WebhookDelivery,
        *,
        error: str,
        retry_after_seconds: int | None = None,
    ) -> None:
        attempts = int(delivery.attempt_count or 0) + 1
        delivery.attempt_count = attempts
        if attempts >= self._runtime.max_attempts:
            self._fail_terminal(delivery, error)
            return
        exponent = max(0, attempts - 1)
        delay = min(
            self._runtime.retry_initial_seconds * (2**exponent),
            self._runtime.retry_max_seconds,
        )
        if retry_after_seconds is not None:
            delay = min(max(delay, retry_after_seconds), self._runtime.retry_max_seconds)
        now = utcnow()
        delivery.status = "retrying"
        delivery.next_attempt_at = now + timedelta(seconds=delay)
        delivery.last_error = self._safe_error(error)
        delivery.updated_at = now

    def _fail_terminal(self, delivery: WebhookDelivery, error: str) -> None:
        now = utcnow()
        delivery.status = "failed"
        delivery.last_error = self._safe_error(error)
        delivery.updated_at = now
        delivery.next_attempt_at = now

    def _purge_if_due(self) -> None:
        retention_days = self._runtime.retention_days
        if retention_days <= 0:
            return
        now = utcnow()
        if self._last_purge_at is not None and (now - self._last_purge_at).total_seconds() < 3600:
            return
        cutoff = now - timedelta(days=retention_days)
        with self._session_factory() as db:
            db.query(WebhookDelivery).filter(
                WebhookDelivery.status.in_(_TERMINAL_STATUSES),
                WebhookDelivery.updated_at < cutoff,
            ).delete(synchronize_session=False)
            db.commit()
        self._last_purge_at = now

    def _retry_after_seconds(self, value: str | None) -> int | None:
        if not value:
            return None
        text = value.strip()
        try:
            return max(0, int(text))
        except ValueError:
            pass
        try:
            target = parsedate_to_datetime(text)
            now = utcnow()
            if target.tzinfo is None:
                target = target.replace(tzinfo=now.tzinfo)
            return max(0, int((target - now).total_seconds()))
        except (TypeError, ValueError, OverflowError):
            return None

    @staticmethod
    def _safe_error(value: str) -> str:
        return str(sanitize_error_detail(value or "Webhook delivery failed"))[:2048]


_worker_singleton: Optional[WebhookDeliveryWorker] = None
_worker_lock = threading.Lock()


def get_webhook_delivery_worker(session_factory: sessionmaker) -> WebhookDeliveryWorker:
    global _worker_singleton
    with _worker_lock:
        if _worker_singleton is None:
            _worker_singleton = WebhookDeliveryWorker(session_factory)
        return _worker_singleton


def reset_webhook_delivery_worker_for_tests(*, timeout: float = 0.5) -> None:
    global _worker_singleton
    with _worker_lock:
        worker = _worker_singleton
        _worker_singleton = None
    if worker is not None:
        worker.stop(timeout=timeout)
