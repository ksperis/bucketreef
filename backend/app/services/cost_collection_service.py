# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional, TypeVar

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import (
    add_and_flush_in_savepoint,
    run_replayable_db_unit,
)
from app.db import CostStorageDaily, CostUsageDaily, S3Account, S3User, StorageEndpoint
from app.core.domain_enums import (
    CostCollectionStage,
    CostSubjectCollectionStage,
    S3SubjectType,
    StorageProvider,
)
from app.models.cost import (
    CostCollectionError,
    CostCollectionResult,
    CostEndpointCollectionError,
    CostSubjectCollectionError,
)
from app.models.retention import DataRetentionResult
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

_DailyCostRow = TypeVar("_DailyCostRow", CostUsageDaily, CostStorageDaily)
_COST_USAGE_SOURCE = "rgw_admin_usage"
_COST_STORAGE_SOURCE = "rgw_admin_bucket_stats"


@dataclass(frozen=True)
class _CostSubject:
    kind: S3SubjectType
    id: int
    principal: S3Account | S3User
    s3_account_id: int | None
    s3_user_id: int | None


def _collection_error(
    *,
    stage: CostCollectionStage,
    endpoint_id: int,
    subject: S3SubjectType | None = None,
    subject_id: int | None = None,
) -> CostCollectionError:
    if stage == "endpoint":
        return CostEndpointCollectionError(stage=stage, endpoint_id=endpoint_id)
    if subject is None or subject_id is None:
        raise ValueError(f"{stage} collection errors require a subject")
    return CostSubjectCollectionError(
        stage=stage,
        endpoint_id=endpoint_id,
        subject=subject,
        subject_id=subject_id,
    )


class CostCollector:
    """Collect and persist daily RGW usage and storage cost inputs."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def collect_daily(self, day: date) -> CostCollectionResult:
        from app.services.app_settings_service import load_app_settings_for_db

        app_settings = load_app_settings_for_db(self.db)
        if not app_settings.general.cost_enabled:
            raise ValueError("Cost is disabled")
        endpoints = self.db.scalars(
            select(StorageEndpoint).where(
                StorageEndpoint.provider == StorageProvider.CEPH.value
            )
        ).all()
        endpoints_count = 0
        usage_records = 0
        storage_records = 0
        errors: list[CostCollectionError] = []
        for endpoint in endpoints:
            flags = resolve_feature_flags(endpoint)
            if not flags.admin_enabled:
                continue
            try:
                rgw_admin = get_supervision_rgw_client(endpoint)
            except (RGWAdminError, ValueError) as exc:
                logger.warning(
                    "Cost collection skipped for endpoint %s: %s",
                    endpoint.id,
                    exc,
                )
                errors.append(
                    _collection_error(stage="endpoint", endpoint_id=endpoint.id)
                )
                continue

            subjects = self._load_subjects(endpoint)
            for subject in subjects:
                self.db.expunge(subject.principal)
            self.db.expunge(endpoint)
            # All RGW inputs are now detached snapshots. Close the database
            # read transaction before issuing any remote Admin Ops calls.
            self.db.rollback()

            endpoints_count += 1
            if flags.usage_enabled:
                created_usage_records, usage_errors = self._collect_usage_for_endpoint(
                    rgw_admin,
                    endpoint,
                    day,
                    subjects=subjects,
                )
                usage_records += created_usage_records
                errors.extend(usage_errors)

            created_storage_records, storage_errors = self._collect_storage_for_endpoint(
                rgw_admin,
                endpoint,
                day,
                subjects=subjects,
            )
            storage_records += created_storage_records
            errors.extend(storage_errors)
        retention_now = utcnow()
        return CostCollectionResult(
            day=day.isoformat(),
            endpoints=endpoints_count,
            usage_records=usage_records,
            storage_records=storage_records,
            errors=errors,
            retention=DataRetentionResult.model_validate(
                run_replayable_db_unit(
                    self.db,
                    lambda write_db: DataRetentionService(
                        write_db,
                        commit_on_success=False,
                        reference_now=retention_now,
                    ).purge_all(),
                )
            ),
        )

    def _load_subjects(self, endpoint: StorageEndpoint) -> list[_CostSubject]:
        accounts = self.db.scalars(
            select(S3Account).where(S3Account.storage_endpoint_id == endpoint.id)
        ).all()
        s3_users = self.db.scalars(
            select(S3User).where(S3User.storage_endpoint_id == endpoint.id)
        ).all()
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
        stage: CostSubjectCollectionStage,
        endpoint: StorageEndpoint,
        subject: _CostSubject,
        exc: Exception,
    ) -> CostCollectionError:
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
        stage: CostSubjectCollectionStage,
        endpoint: StorageEndpoint,
        subjects: list[_CostSubject],
        operation: Callable[[_CostSubject], None],
    ) -> tuple[int, list[CostCollectionError]]:
        created = 0
        errors: list[CostCollectionError] = []
        for subject in subjects:
            try:
                operation(subject)
                created += 1
            except (RGWAdminError, ValueError) as exc:
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
        total_bytes, total_objects = self._collect_bucket_stats(
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
        )

    def _collect_usage_for_endpoint(
        self,
        rgw_admin: RGWAdminClient,
        endpoint: StorageEndpoint,
        day: date,
        *,
        subjects: list[_CostSubject],
    ) -> tuple[int, list[CostCollectionError]]:
        start = datetime.combine(day, datetime.min.time()).replace(
            tzinfo=timezone.utc
        )
        end = start + timedelta(days=1)
        return self._collect_subjects(
            stage="usage",
            endpoint=endpoint,
            subjects=subjects,
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
        *,
        subjects: list[_CostSubject],
    ) -> tuple[int, list[CostCollectionError]]:
        return self._collect_subjects(
            stage="storage",
            endpoint=endpoint,
            subjects=subjects,
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
    ) -> tuple[int, int]:
        payload = rgw_admin.get_all_buckets(uid=uid, with_stats=True)
        buckets = extract_bucket_list(payload)
        total_bytes = 0
        total_objects = 0
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
        return total_bytes, total_objects

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
        stored_breakdown = ops_breakdown or None

        def update_existing(row: CostUsageDaily, collected_at: datetime) -> None:
            row.bytes_in = bytes_in
            row.bytes_out = bytes_out
            row.ops_total = ops_total
            row.ops_breakdown = stored_breakdown
            row.collected_at = collected_at

        self._upsert_daily_row(
            find_existing=lambda write_db: self._find_daily_row(
                write_db,
                CostUsageDaily,
                source=_COST_USAGE_SOURCE,
                day=day,
                endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
            ),
            build_row=lambda collected_at: CostUsageDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                bytes_in=bytes_in,
                bytes_out=bytes_out,
                ops_total=ops_total,
                ops_breakdown=stored_breakdown,
                source=_COST_USAGE_SOURCE,
                collected_at=collected_at,
            ),
            update_existing=update_existing,
        )

    def _upsert_storage(
        self,
        *,
        day: date,
        endpoint_id: int,
        s3_account_id: Optional[int],
        s3_user_id: Optional[int],
        total_bytes: int,
        total_objects: int,
    ) -> None:
        def update_existing(row: CostStorageDaily, collected_at: datetime) -> None:
            row.total_bytes = total_bytes
            row.total_objects = total_objects
            row.collected_at = collected_at

        self._upsert_daily_row(
            find_existing=lambda write_db: self._find_daily_row(
                write_db,
                CostStorageDaily,
                source=_COST_STORAGE_SOURCE,
                day=day,
                endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
            ),
            build_row=lambda collected_at: CostStorageDaily(
                day=day,
                storage_endpoint_id=endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                total_bytes=total_bytes,
                total_objects=total_objects,
                source=_COST_STORAGE_SOURCE,
                collected_at=collected_at,
            ),
            update_existing=update_existing,
        )

    def _upsert_daily_row(
        self,
        *,
        find_existing: Callable[[Session], _DailyCostRow | None],
        build_row: Callable[[datetime], _DailyCostRow],
        update_existing: Callable[[_DailyCostRow, datetime], None],
    ) -> None:
        collected_at = utcnow()
        run_replayable_db_unit(
            self.db,
            lambda write_db: self._upsert_daily_row_once(
                write_db,
                find_existing=find_existing,
                build_row=build_row,
                update_existing=update_existing,
                collected_at=collected_at,
            ),
        )

    def _upsert_daily_row_once(
        self,
        write_db: Session,
        *,
        find_existing: Callable[[Session], _DailyCostRow | None],
        build_row: Callable[[datetime], _DailyCostRow],
        update_existing: Callable[[_DailyCostRow, datetime], None],
        collected_at: datetime,
    ) -> None:
        existing = find_existing(write_db)
        if existing is not None:
            update_existing(existing, collected_at)
        else:
            row = build_row(collected_at)
            try:
                add_and_flush_in_savepoint(write_db, row)
            except IntegrityError:
                existing = find_existing(write_db)
                if existing is None:
                    raise
                update_existing(existing, collected_at)

    def _find_daily_row(
        self,
        db: Session,
        model: type[_DailyCostRow],
        *,
        source: str,
        day: date,
        endpoint_id: int,
        s3_account_id: Optional[int],
        s3_user_id: Optional[int],
    ) -> _DailyCostRow | None:
        return db.scalar(
            select(model)
            .where(
                model.day == day,
                model.storage_endpoint_id == endpoint_id,
                model.s3_account_id == s3_account_id,
                model.s3_user_id == s3_user_id,
                model.source == source,
            )
            .limit(1)
        )
