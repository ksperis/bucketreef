# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Callable

from sqlalchemy.orm import Session, sessionmaker

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account
from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as BucketUsageStatsSnapshotRow
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
from app.utils.time import utcnow


logger = logging.getLogger(__name__)
BUCKET_USAGE_STATS_COLLECTION_MAX_AGE = timedelta(hours=24)
BUCKET_USAGE_STATS_COLLECTION_PARALLELISM = 2


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

    def _eligible_accounts(self) -> list[S3Account]:
        settings = load_app_settings_for_db_readonly(self.db)
        accounts = self.db.query(S3Account).order_by(S3Account.id.asc()).all()
        return [
            account
            for account in accounts
            if bucket_usage_stats_state(settings.general.project_feature_policies, account).enabled
            and bucket_usage_stats_collection_state(settings.general.project_collection_policies, account).enabled
        ]

    def _account_due_targets(
        self,
        account: S3Account,
        *,
        cutoff,
    ) -> list[tuple[float, BucketUsageStatsResolvedTarget]]:
        buckets = self.buckets_service.list_buckets(account, include=set(), with_stats=False)
        bucket_names = list(dict.fromkeys(bucket.name for bucket in buckets if bucket.name))
        if not bucket_names:
            return []

        scope_id = str(account.id)
        snapshots = {
            row.bucket_name: row
            for row in self.db.query(BucketUsageStatsSnapshotRow)
            .filter(
                BucketUsageStatsSnapshotRow.scope_kind == "manager",
                BucketUsageStatsSnapshotRow.scope_id == scope_id,
                BucketUsageStatsSnapshotRow.bucket_name.in_(bucket_names),
            )
            .all()
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
                        context=account,
                        bucket_name=bucket_name,
                        scope_kind="manager",
                        scope_id=scope_id,
                        scope_name=account.name,
                        context_id=scope_id,
                        context_name=account.name,
                    ),
                )
            )
        return due

    def collect(self) -> dict[str, object]:
        cutoff = utcnow() - BUCKET_USAGE_STATS_COLLECTION_MAX_AGE
        due_targets: list[tuple[float, BucketUsageStatsResolvedTarget]] = []
        skipped_accounts = 0
        eligible_accounts = self._eligible_accounts()

        for account in eligible_accounts:
            try:
                due_targets.extend(self._account_due_targets(account, cutoff=cutoff))
            except Exception as exc:  # noqa: BLE001
                skipped_accounts += 1
                logger.warning(
                    "Unable to prepare bucket usage statistics collection for account=%s: %s",
                    account.id,
                    sanitized_error_log_detail(exc),
                )

        targets = [target for _, target in sorted(due_targets, key=lambda item: (item[0], item[1].scope_id, item[1].bucket_name))]
        if not targets:
            return {
                "status": "completed",
                "eligible_accounts": len(eligible_accounts),
                "skipped_accounts": skipped_accounts,
                "due_buckets": 0,
                "completed_buckets": 0,
                "failed_buckets": 0,
                "skipped_buckets": 0,
            }

        result = self.usage_stats_service.run(
            targets,
            BucketUsageStatsOptions(parallelism=BUCKET_USAGE_STATS_COLLECTION_PARALLELISM),
        )
        return {
            "status": result.status,
            "eligible_accounts": len(eligible_accounts),
            "skipped_accounts": skipped_accounts,
            "due_buckets": len(targets),
            "completed_buckets": result.completed_buckets,
            "failed_buckets": result.failed_buckets,
            "skipped_buckets": result.skipped_buckets,
        }
