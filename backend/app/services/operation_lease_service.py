# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
import os
import socket
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Iterator, Optional

from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import BackendOperationLease
from app.utils.time import utcnow


logger = logging.getLogger(__name__)


HEALTHCHECK_RUN_OPERATION = "healthchecks:run"
QUOTA_MONITOR_ALERTS_OPERATION = "quota-monitor:alerts"
USAGE_HISTORY_COLLECT_OPERATION = "quota-monitor:usage-history"
USER_NOTIFICATIONS_PURGE_OPERATION = "user-notifications:purge"
ACCESS_KEY_EXPIRATION_RUN_OPERATION = "access-key-expirations:run"
BUCKET_USAGE_STATS_COLLECT_OPERATION = "bucket-usage-stats:collect"
BUCKET_USAGE_STATS_LEASE_TTL_SECONDS = 24 * 60 * 60


def bucket_usage_stats_bucket_operation_name(
    scope: str,
    bucket_name: str,
    *,
    bucket_tenant: str = "",
) -> str:
    normalized_scope = str(scope or "").strip()
    normalized_bucket = str(bucket_name or "").strip()
    normalized_tenant = str(bucket_tenant or "").strip()
    if not normalized_scope or not normalized_bucket:
        raise ValueError("Bucket usage statistics lease scope and bucket are required")
    bucket_identity = (
        f"{normalized_tenant}:{normalized_bucket}"
        if normalized_tenant
        else normalized_bucket
    )
    return f"bucket-usage-stats:bucket:{normalized_scope}:{bucket_identity}"


def cost_daily_operation_name(day_iso: str) -> str:
    return f"cost:daily:{day_iso}"


def default_operation_lease_ttl_seconds() -> int:
    return max(15, int(get_settings().operation_lease_ttl_seconds))


def cost_operation_lease_ttl_seconds() -> int:
    return max(60, int(get_settings().cost_operation_lease_ttl_seconds))


def generate_operation_owner(prefix: str = "backend") -> str:
    hostname = socket.gethostname() or "unknown-host"
    return f"{prefix}:{hostname}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


@dataclass(frozen=True)
class OperationLeaseHandle:
    operation_name: str
    owner: str
    lease_until: datetime


class OperationLeaseService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def acquire(
        self,
        operation_name: str,
        *,
        ttl_seconds: int,
        owner: Optional[str] = None,
        lease_context: Optional[dict[str, Any]] = None,
    ) -> Optional[OperationLeaseHandle]:
        name = self._normalize_operation_name(operation_name)
        lease_owner = owner or generate_operation_owner()
        now = utcnow()
        ttl = max(15, int(ttl_seconds))
        lease_until = now + timedelta(seconds=ttl)
        metadata_json = json.dumps(lease_context, ensure_ascii=True, sort_keys=True) if lease_context else None
        values = {
            BackendOperationLease.lease_owner: lease_owner,
            BackendOperationLease.lease_until: lease_until,
            BackendOperationLease.acquired_at: now,
            BackendOperationLease.updated_at: now,
            BackendOperationLease.metadata_json: metadata_json,
        }

        updated = self.db.execute(
            update(BackendOperationLease)
            .where(
                BackendOperationLease.operation_name == name,
                or_(
                    BackendOperationLease.lease_until <= now,
                    BackendOperationLease.lease_owner == lease_owner,
                ),
            )
            .values(values)
            .execution_options(synchronize_session=False)
        ).rowcount
        if updated == 1:
            self.db.commit()
            return OperationLeaseHandle(operation_name=name, owner=lease_owner, lease_until=lease_until)

        self.db.rollback()
        row = BackendOperationLease(
            operation_name=name,
            lease_owner=lease_owner,
            lease_until=lease_until,
            acquired_at=now,
            updated_at=now,
            metadata_json=metadata_json,
        )
        self.db.add(row)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            return None
        return OperationLeaseHandle(operation_name=name, owner=lease_owner, lease_until=lease_until)

    def release(self, handle: OperationLeaseHandle) -> None:
        now = utcnow()
        self.db.execute(
            update(BackendOperationLease)
            .where(
                BackendOperationLease.operation_name == handle.operation_name,
                BackendOperationLease.lease_owner == handle.owner,
            )
            .values(
                {
                    BackendOperationLease.lease_until: now,
                    BackendOperationLease.updated_at: now,
                }
            )
            .execution_options(synchronize_session=False)
        )
        self.db.commit()

    @contextmanager
    def hold(
        self,
        operation_name: str,
        *,
        ttl_seconds: int,
        owner: Optional[str] = None,
        lease_context: Optional[dict[str, Any]] = None,
    ) -> Iterator[Optional[OperationLeaseHandle]]:
        handle = self.acquire(
            operation_name,
            ttl_seconds=ttl_seconds,
            owner=owner,
            lease_context=lease_context,
        )
        try:
            yield handle
        except BaseException:
            if handle is not None:
                self._release_after_failed_work(handle)
            raise
        else:
            if handle is not None:
                self.release(handle)

    def _release_after_failed_work(self, handle: OperationLeaseHandle) -> None:
        try:
            self.db.rollback()
        except Exception:
            logger.exception(
                "Unable to rollback failed work before releasing operation lease %s",
                handle.operation_name,
            )
        try:
            self.release(handle)
        except Exception:
            logger.exception(
                "Unable to release operation lease %s after failed work",
                handle.operation_name,
            )

    def current_owner(self, operation_name: str) -> Optional[str]:
        name = self._normalize_operation_name(operation_name)
        now = utcnow()
        owner = self.db.scalars(
            select(BackendOperationLease.lease_owner)
            .where(
                BackendOperationLease.operation_name == name,
                BackendOperationLease.lease_until > now,
            )
            .limit(1)
        ).first()
        return str(owner) if owner else None

    @staticmethod
    def _normalize_operation_name(operation_name: str) -> str:
        normalized = str(operation_name or "").strip()
        if not normalized:
            raise ValueError("operation_name is required")
        return normalized
