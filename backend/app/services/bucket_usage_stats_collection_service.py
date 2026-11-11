# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account, S3User
from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as BucketUsageStatsSnapshotRow
from app.models.bucket_usage_stats import BucketUsageStatsCollectionResult
from app.services.app_settings_service import load_app_settings_for_db
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsOptions,
    BucketUsageStatsResolvedTarget,
    BucketUsageStatsService,
)
from app.services.buckets_service import BucketsService
from app.services.feature_policy_service import (
    bucket_usage_stats_collection_state,
    bucket_usage_stats_state,
)
from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import (
    ResolvedS3BucketTarget,
    S3ExecutionContext,
    S3ExecutionTarget,
)
from app.utils.time import utcnow


logger = logging.getLogger(__name__)
BUCKET_USAGE_STATS_COLLECTION_MAX_AGE = timedelta(hours=24)
BUCKET_USAGE_STATS_COLLECTION_PARALLELISM = 2
UsageCollectionResource = S3Account | S3User


@dataclass(frozen=True)
class _UsageCollectionResourceSnapshot:
    kind: Literal["account", "s3_user"]
    id: int
    name: str
    access_key: str | None
    secret_key: str | None = field(repr=False)
    rgw_account_id: str | None = None
    rgw_user_uid: str | None = None
    rgw_tenant: str = ""
    storage_endpoint_id: int | None = None
    endpoint_url: str | None = None
    region: str | None = None
    force_path_style: bool = False
    verify_tls: bool = True

    @property
    def scope_id(self) -> str:
        return f"s3u-{self.id}" if self.kind == "s3_user" else str(self.id)

    def execution_context(self) -> S3ExecutionContext:
        return S3ExecutionContext(
            context_id=self.scope_id,
            context_kind="s3_user" if self.kind == "s3_user" else "account",
            name=self.name,
            access_key=self.access_key,
            secret_key=self.secret_key,
            id=self.id if self.kind == "account" else None,
            rgw_account_id=self.rgw_account_id,
            rgw_user_uid=self.rgw_user_uid,
            rgw_tenant=self.rgw_tenant,
            storage_endpoint_id=self.storage_endpoint_id,
            session_endpoint=self.endpoint_url,
            session_region=self.region,
            session_force_path_style=self.force_path_style,
            session_verify_tls=self.verify_tls,
            s3_user_id=self.id if self.kind == "s3_user" else None,
        )


class BucketUsageStatsCollectionService:
    def __init__(
        self,
        db: Session,
        session_factory: sessionmaker[Session] | Callable[[], Session],
        *,
        buckets_service: BucketsService | None = None,
        usage_stats_service: BucketUsageStatsService | None = None,
    ) -> None:
        self.db = db
        self.buckets_service = buckets_service or BucketsService()
        self.usage_stats_service = usage_stats_service or BucketUsageStatsService(session_factory)

    def _eligible_resources(self) -> list[_UsageCollectionResourceSnapshot]:
        try:
            settings = load_app_settings_for_db(self.db)
            accounts = self.db.scalars(select(S3Account).order_by(S3Account.id.asc())).all()
            users = self.db.scalars(select(S3User).order_by(S3User.id.asc())).all()
            return [
                self._snapshot_resource(resource)
                for resource in [*accounts, *users]
                if bucket_usage_stats_state(settings.general.project_feature_policies, resource).enabled
                and bucket_usage_stats_collection_state(settings.general.project_collection_policies, resource).enabled
            ]
        finally:
            # The returned objects contain only primitive S3 client inputs. Close
            # the read snapshot before any remote bucket listing is attempted.
            self.db.rollback()

    @staticmethod
    def _snapshot_resource(resource: UsageCollectionResource) -> _UsageCollectionResourceSnapshot:
        endpoint = resource.storage_endpoint
        is_s3_user = isinstance(resource, S3User)
        return _UsageCollectionResourceSnapshot(
            kind="s3_user" if is_s3_user else "account",
            id=int(resource.id),
            name=resource.name,
            access_key=resource.rgw_access_key,
            secret_key=resource.rgw_secret_key,
            rgw_account_id=None if is_s3_user else resource.rgw_account_id,
            rgw_user_uid=resource.rgw_user_uid,
            rgw_tenant=resource.rgw_tenant or "",
            storage_endpoint_id=resource.storage_endpoint_id,
            endpoint_url=endpoint.endpoint_url if endpoint is not None else None,
            region=endpoint.region if endpoint is not None else None,
            force_path_style=bool(endpoint.force_path_style) if endpoint is not None else False,
            verify_tls=bool(endpoint.verify_tls) if endpoint is not None else True,
        )

    def _resource_due_targets(
        self,
        resource: _UsageCollectionResourceSnapshot,
        *,
        cutoff,
    ) -> list[tuple[float, BucketUsageStatsResolvedTarget]]:
        execution_target = resource.execution_context()
        buckets = self.buckets_service.list_buckets(execution_target, include=set(), with_stats=False)
        bucket_names = list(dict.fromkeys(bucket.name for bucket in buckets if bucket.name))
        if not bucket_names:
            return []

        scope_id = resource.scope_id
        try:
            snapshot_times = dict(
                self.db.execute(
                    select(
                        BucketUsageStatsSnapshotRow.bucket_name,
                        BucketUsageStatsSnapshotRow.calculated_at,
                    ).where(
                        BucketUsageStatsSnapshotRow.scope_kind == "manager",
                        BucketUsageStatsSnapshotRow.scope_id == scope_id,
                        BucketUsageStatsSnapshotRow.bucket_name.in_(bucket_names),
                    )
                ).all()
            )
        finally:
            # Each remote listing is followed by a fresh, short DB read. Do not
            # carry that snapshot into the next S3 call or the long-running scan.
            self.db.rollback()

        due: list[tuple[float, BucketUsageStatsResolvedTarget]] = []
        for bucket_name in bucket_names:
            calculated_at = snapshot_times.get(bucket_name)
            if calculated_at is not None and calculated_at > cutoff:
                continue
            priority = calculated_at.timestamp() if calculated_at is not None else float("-inf")
            due.append(
                (
                    priority,
                    BucketUsageStatsResolvedTarget.from_bucket_target(
                        ResolvedS3BucketTarget.from_context(execution_target, bucket_name),
                        scope_kind="manager",
                        scope_id=scope_id,
                        scope_name=resource.name,
                    ),
                )
            )
        return due

    def collect(self) -> BucketUsageStatsCollectionResult:
        cutoff = utcnow() - BUCKET_USAGE_STATS_COLLECTION_MAX_AGE
        due_targets: list[tuple[float, BucketUsageStatsResolvedTarget]] = []
        skipped_resources = 0
        eligible_resources = self._eligible_resources()

        for resource in eligible_resources:
            try:
                due_targets.extend(self._resource_due_targets(resource, cutoff=cutoff))
            except S3OperationError as exc:
                skipped_resources += 1
                logger.warning(
                    "Unable to prepare bucket usage statistics collection for %s=%s: %s",
                    resource.kind,
                    resource.id,
                    sanitized_error_log_detail(exc),
                )

        targets = [target for _, target in sorted(due_targets, key=lambda item: (item[0], item[1].scope_id, item[1].bucket_name))]
        if not targets:
            return BucketUsageStatsCollectionResult(
                status="completed",
                eligible_accounts=len(eligible_resources),
                skipped_accounts=skipped_resources,
                due_buckets=0,
                completed_buckets=0,
                failed_buckets=0,
                skipped_buckets=0,
            )

        result = self.usage_stats_service.run(
            targets,
            BucketUsageStatsOptions(parallelism=BUCKET_USAGE_STATS_COLLECTION_PARALLELISM),
        )
        return BucketUsageStatsCollectionResult(
            status=result.status,
            eligible_accounts=len(eligible_resources),
            skipped_accounts=skipped_resources,
            due_buckets=len(targets),
            completed_buckets=result.completed_buckets,
            failed_buckets=result.failed_buckets,
            skipped_buckets=result.skipped_buckets,
        )
