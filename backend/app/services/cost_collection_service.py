# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Literal, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import (
    CostStorageDaily,
    CostUsageDaily,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.services.data_retention_service import DataRetentionService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.traffic_service import aggregate_usage, flatten_usage_entries
from app.utils.numbers import int_or_zero
from app.utils.rgw_payloads import extract_bucket_list, rgw_qualified_uid
from app.services.rgw_principal_scope import resolve_target_tenant
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow
from app.utils.usage_stats import extract_usage_stats


logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass(frozen=True)
class _CostSubject:
    kind: Literal["account", "s3_user"]
    id: int
    principal: S3Account | S3User
    s3_account_id: int | None
    s3_user_id: int | None


def _collection_error(
    *,
    stage: str,
    endpoint_id: int,
    subject: str | None = None,
    subject_id: int | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"stage": stage, "endpoint_id": endpoint_id}
    if subject is not None:
        error["subject"] = subject
    if subject_id is not None:
        error["subject_id"] = subject_id
    return error


class CostCollector:
    """Collect and persist daily RGW usage and storage cost inputs."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def collect_daily(self, day: date) -> dict[str, Any]:
        from app.services.app_settings_service import load_app_settings

        app_settings = load_app_settings()
        if not app_settings.general.cost_enabled:
            raise ValueError("Cost is disabled")
        endpoints = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.provider == StorageProvider.CEPH.value)
            .all()
        )
        summary: dict[str, Any] = {
            "day": day.isoformat(),
            "endpoints": 0,
            "usage_records": 0,
            "storage_records": 0,
            "errors": [],
        }
        for endpoint in endpoints:
            flags = resolve_feature_flags(endpoint)
            if not flags.admin_enabled:
                continue
            try:
                rgw_admin = get_supervision_rgw_client(endpoint)
            except Exception as exc:
                logger.warning(
                    "Cost collection skipped for endpoint %s: %s",
                    endpoint.id,
                    exc,
                )
                summary["errors"].append(
                    _collection_error(stage="endpoint", endpoint_id=endpoint.id)
                )
                continue

            summary["endpoints"] += 1
            if flags.usage_enabled:
                usage_records, usage_errors = self._collect_usage_for_endpoint(
                    rgw_admin,
                    endpoint,
                    day,
                )
                summary["usage_records"] += usage_records
                summary["errors"].extend(usage_errors)

            storage_records, storage_errors = self._collect_storage_for_endpoint(
                rgw_admin,
                endpoint,
                day,
            )
            summary["storage_records"] += storage_records
            summary["errors"].extend(storage_errors)
        summary["retention"] = DataRetentionService(self.db).purge_all()
        return summary

    def _load_subjects(self, endpoint: StorageEndpoint) -> list[_CostSubject]:
        accounts = (
            self.db.query(S3Account)
            .filter(S3Account.storage_endpoint_id == endpoint.id)
            .all()
        )
        s3_users = (
            self.db.query(S3User)
            .filter(S3User.storage_endpoint_id == endpoint.id)
            .all()
        )
        subjects = [
            _CostSubject(
                kind="account",
                id=int(account.id),
                principal=account,
                s3_account_id=int(account.id),
                s3_user_id=None,
            )
            for account in accounts
        ]
        subjects.extend(
            _CostSubject(
                kind="s3_user",
                id=int(s3_user.id),
                principal=s3_user,
                s3_account_id=None,
                s3_user_id=int(s3_user.id),
            )
            for s3_user in s3_users
            if s3_user.rgw_user_uid
        )
        return subjects

    @staticmethod
    def _collection_failure(
        *,
        stage: Literal["usage", "storage"],
        endpoint: StorageEndpoint,
        subject: _CostSubject,
        exc: Exception,
    ) -> dict[str, Any]:
        subject_label = "account" if subject.kind == "account" else "s3 user"
        if isinstance(exc, RGWAdminError):
            logger.warning(
                "%s collection failed for %s %s: %s",
                stage.capitalize(),
                subject_label,
                subject.id,
                exc,
            )
        else:
            logger.exception(
                "%s collection error for %s %s",
                stage.capitalize(),
                subject_label,
                subject.id,
            )
        return _collection_error(
            stage=stage,
            endpoint_id=endpoint.id,
            subject=subject.kind,
            subject_id=subject.id,
        )

    def _collect_subjects(
        self,
        *,
        stage: Literal["usage", "storage"],
        endpoint: StorageEndpoint,
        operation: Callable[[_CostSubject], None],
    ) -> tuple[int, list[dict[str, Any]]]:
        created = 0
        errors: list[dict[str, Any]] = []
        for subject in self._load_subjects(endpoint):
            try:
                operation(subject)
                created += 1
            except RGWAdminError as exc:
                errors.append(
                    self._collection_failure(
                        stage=stage,
                        endpoint=endpoint,
                        subject=subject,
                        exc=exc,
                    )
                )
            except Exception as exc:
                errors.append(
                    self._collection_failure(
                        stage=stage,
                        endpoint=endpoint,
                        subject=subject,
                        exc=exc,
                    )
                )
        return created, errors

    def _collect_usage_subject(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
        start: datetime,
        end: datetime,
        subject: _CostSubject,
    ) -> None:
        if subject.kind == "account":
            usage_uid = subject.principal.rgw_account_id
        else:
            usage_uid = rgw_qualified_uid(
                subject.principal.rgw_user_uid,
                resolve_target_tenant(subject.principal),
            )
        payload = rgw_admin.get_usage(
            uid=usage_uid,
            start=start,
            end=end,
            show_entries=True,
            show_summary=False,
        )
        entries = flatten_usage_entries(payload)
        aggregation = aggregate_usage(
            entries,
            start=start,
            end=end - timedelta(microseconds=1),
        )
        totals = aggregation.get("totals", {})
        breakdown = {
            entry["category"]: entry["ops"]
            for entry in aggregation.get("category_breakdown", [])
            if entry.get("category")
        }
        self._upsert_usage(
            day=day,
            endpoint_id=endpoint.id,
            s3_account_id=subject.s3_account_id,
            s3_user_id=subject.s3_user_id,
            bytes_in=int_or_zero(totals.get("bytes_in")),
            bytes_out=int_or_zero(totals.get("bytes_out")),
            ops_total=int_or_zero(totals.get("ops")),
            ops_breakdown=breakdown,
        )

    def _collect_storage_subject(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
        subject: _CostSubject,
    ) -> None:
        uid = subject.principal.rgw_user_uid
        if not uid:
            raise ValueError("RGW account root UID is unavailable")
        storage_uid = rgw_qualified_uid(
            uid,
            resolve_target_tenant(subject.principal),
        )
        total_bytes, total_objects, by_bucket = self._collect_bucket_stats(
            rgw_admin,
            storage_uid,
        )
        self._upsert_storage(
            day=day,
            endpoint_id=endpoint.id,
            s3_account_id=subject.s3_account_id,
            s3_user_id=subject.s3_user_id,
            total_bytes=total_bytes,
            total_objects=total_objects,
            by_bucket=by_bucket,
        )

    def _collect_usage_for_endpoint(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
    ) -> tuple[int, list[dict[str, Any]]]:
        start = datetime.combine(day, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )
        end = start + timedelta(days=1)
        return self._collect_subjects(
            stage="usage",
            endpoint=endpoint,
            operation=lambda subject: self._collect_usage_subject(
                rgw_admin,
                endpoint,
                day,
                start,
                end,
                subject,
            ),
        )

    def _collect_storage_for_endpoint(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
    ) -> tuple[int, list[dict[str, Any]]]:
        return self._collect_subjects(
            stage="storage",
            endpoint=endpoint,
            operation=lambda subject: self._collect_storage_subject(
                rgw_admin,
                endpoint,
                day,
                subject,
            ),
        )

    def _collect_bucket_stats(
        self,
        rgw_admin: RGWAdminClient,
        uid: str,
    ) -> tuple[int, int, Optional[dict[str, dict[str, int]]]]:
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
        buckets = extract_bucket_list(payload)
        total_bytes = 0
        total_objects = 0
        by_bucket: dict[str, dict[str, int]] = {}
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            name = bucket.get("bucket") or bucket.get("name")
            if not name:
                continue
            usage = bucket.get("usage")
            if usage == {}:
                used_bytes, object_count = 0, 0
            else:
                used_bytes, object_count = extract_usage_stats(usage)
                if used_bytes is None or object_count is None:
                    raise ValueError("RGW bucket statistics are incomplete")
            total_bytes += used_bytes
            total_objects += object_count
            if settings.cost_store_by_bucket:
                by_bucket[str(name)] = {
                    "used_bytes": int(used_bytes),
                    "object_count": int(object_count),
                }
        return (
            total_bytes,
            total_objects,
            by_bucket if settings.cost_store_by_bucket else None,
        )

    def _upsert_usage(
        self,
        *,
        day: date,
        endpoint_id: int,
        s3_account_id: Optional[int],
        s3_user_id: Optional[int],
        bytes_in: int,
        bytes_out: int,
        ops_total: int,
        ops_breakdown: Optional[dict[str, int]],
    ) -> None:
        existing = (
            self.db.query(CostUsageDaily)
            .filter(
                CostUsageDaily.day == day,
                CostUsageDaily.storage_endpoint_id == endpoint_id,
                CostUsageDaily.s3_account_id == s3_account_id,
                CostUsageDaily.s3_user_id == s3_user_id,
                CostUsageDaily.source == "rgw_admin_usage",
            )
            .first()
        )
        payload = json.dumps(ops_breakdown) if ops_breakdown else None
        now = utcnow()
        if existing:
            existing.bytes_in = bytes_in
            existing.bytes_out = bytes_out
            existing.ops_total = ops_total
            existing.ops_breakdown = payload
            existing.collected_at = now
        else:
            row = CostUsageDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                bytes_in=bytes_in,
                bytes_out=bytes_out,
                ops_total=ops_total,
                ops_breakdown=payload,
                source="rgw_admin_usage",
                collected_at=now,
            )
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                existing = (
                    self.db.query(CostUsageDaily)
                    .filter(
                        CostUsageDaily.day == day,
                        CostUsageDaily.storage_endpoint_id == endpoint_id,
                        CostUsageDaily.s3_account_id == s3_account_id,
                        CostUsageDaily.s3_user_id == s3_user_id,
                        CostUsageDaily.source == "rgw_admin_usage",
                    )
                    .first()
                )
                if existing is None:
                    raise
                existing.bytes_in = bytes_in
                existing.bytes_out = bytes_out
                existing.ops_total = ops_total
                existing.ops_breakdown = payload
                existing.collected_at = now
        self.db.commit()

    def _upsert_storage(
        self,
        *,
        day: date,
        endpoint_id: int,
        s3_account_id: Optional[int],
        s3_user_id: Optional[int],
        total_bytes: int,
        total_objects: int,
        by_bucket: Optional[dict[str, dict[str, int]]],
    ) -> None:
        existing = (
            self.db.query(CostStorageDaily)
            .filter(
                CostStorageDaily.day == day,
                CostStorageDaily.storage_endpoint_id == endpoint_id,
                CostStorageDaily.s3_account_id == s3_account_id,
                CostStorageDaily.s3_user_id == s3_user_id,
                CostStorageDaily.source == "rgw_admin_bucket_stats",
            )
            .first()
        )
        payload = json.dumps(by_bucket) if by_bucket else None
        now = utcnow()
        if existing:
            existing.total_bytes = total_bytes
            existing.total_objects = total_objects
            existing.by_bucket = payload
            existing.collected_at = now
        else:
            row = CostStorageDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                total_bytes=total_bytes,
                total_objects=total_objects,
                by_bucket=payload,
                source="rgw_admin_bucket_stats",
                collected_at=now,
            )
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                existing = (
                    self.db.query(CostStorageDaily)
                    .filter(
                        CostStorageDaily.day == day,
                        CostStorageDaily.storage_endpoint_id == endpoint_id,
                        CostStorageDaily.s3_account_id == s3_account_id,
                        CostStorageDaily.s3_user_id == s3_user_id,
                        CostStorageDaily.source == "rgw_admin_bucket_stats",
                    )
                    .first()
                )
                if existing is None:
                    raise
                existing.total_bytes = total_bytes
                existing.total_objects = total_objects
                existing.by_bucket = payload
                existing.collected_at = now
        self.db.commit()
