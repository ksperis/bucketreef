# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account, S3User
from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as BucketUsageStatsSnapshotRow
from app.models.bucket_usage_stats import BucketUsageStatsCollectionResult
from app.services.app_settings_service import load_app_settings_for_db_readonly
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
from app.services.s3_execution_context import S3ExecutionContext, S3ExecutionTarget
from app.utils.time import utcnow


logger = logging.getLogger(__name__)
BUCKET_USAGE_STATS_COLLECTION_MAX_AGE = timedelta(hours=24)
BUCKET_USAGE_STATS_COLLECTION_PARALLELISM = 2
UsageCollectionResource = S3Account | S3User


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

    def _eligible_resources(self) -> list[UsageCollectionResource]:
        settings = load_app_settings_for_db_readonly(self.db)
        accounts = self.db.scalars(select(S3Account).order_by(S3Account.id.asc())).all()
        users = self.db.scalars(select(S3User).order_by(S3User.id.asc())).all()
        return [
            resource
            for resource in [*accounts, *users]
            if bucket_usage_stats_state(settings.general.project_feature_policies, resource).enabled
            and bucket_usage_stats_collection_state(settings.general.project_collection_policies, resource).enabled
        ]

    @staticmethod
    def _execution_target(resource: UsageCollectionResource) -> S3ExecutionTarget:
        if isinstance(resource, S3User):
            return S3ExecutionContext.from_s3_user(resource)
        return resource

    @staticmethod
    def _scope_id(resource: UsageCollectionResource) -> str:
        return f"s3u-{resource.id}" if isinstance(resource, S3User) else str(resource.id)

    def _resource_due_targets(
        self,
        resource: UsageCollectionResource,
        *,
        cutoff,
    ) -> list[tuple[float, BucketUsageStatsResolvedTarget]]:
        execution_target = self._execution_target(resource)
        buckets = self.buckets_service.list_buckets(execution_target, include=set(), with_stats=False)
        bucket_names = list(dict.fromkeys(bucket.name for bucket in buckets if bucket.name))
        if not bucket_names:
            return []

        scope_id = self._scope_id(resource)
        snapshots = {
            row.bucket_name: row
            for row in self.db.scalars(
                select(BucketUsageStatsSnapshotRow).where(
                    BucketUsageStatsSnapshotRow.scope_kind == "manager",
                    BucketUsageStatsSnapshotRow.scope_id == scope_id,
                    BucketUsageStatsSnapshotRow.bucket_name.in_(bucket_names),
                )
            ).all()
        }
        due: list[tuple[float, BucketUsageStatsResolvedTarget]] = []
        for bucket_name in bucket_names:
            snapshot = snapshots.get(bucket_name)
            if snapshot is not None and snapshot.calculated_at > cutoff:
                continue
            priority = snapshot.calculated_at.timestamp() if snapshot is not None else float("-inf")
            due.append(
                (
                    priority,
                    BucketUsageStatsResolvedTarget(
                        context=execution_target,
                        bucket_name=bucket_name,
                        scope_kind="manager",
                        scope_id=scope_id,
                        scope_name=resource.name,
                        context_id=scope_id,
                        context_name=resource.name,
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
            except Exception as exc:  # noqa: BLE001
                skipped_resources += 1
                logger.warning(
                    "Unable to prepare bucket usage statistics collection for %s=%s: %s",
                    "s3_user" if isinstance(resource, S3User) else "account",
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
