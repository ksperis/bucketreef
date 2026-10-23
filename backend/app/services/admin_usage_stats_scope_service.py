# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import S3Account, StorageEndpoint, StorageProvider
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsResolvedTarget,
)
from app.services.buckets_service import BucketsService


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AdminManagedUsageScope:
    resolved_targets: list[BucketUsageStatsResolvedTarget]
    aggregate_targets: list[BucketUsageStatsAggregateTarget]
    warnings: list[str]
    managed_account_count: int
    accounts_with_listed_buckets: int
    skipped_account_count: int


class AdminUsageStatsScopeService:
    """Build the managed-account scope used by Admin bucket usage statistics."""

    def __init__(self, db: Session, bucket_service: BucketsService) -> None:
        self.db = db
        self.bucket_service = bucket_service

    def resolve_ceph_endpoint(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if endpoint is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Endpoint not found.",
            )
        if endpoint.provider != StorageProvider.CEPH.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This endpoint is not a Ceph endpoint.",
            )
        return endpoint

    @staticmethod
    def _manager_scope_id(account: S3Account) -> str:
        account_id = account.id
        if not isinstance(account_id, int) or account_id <= 0:
            raise ValueError("Managed S3 account is missing a local identifier.")
        return str(account_id)

    @staticmethod
    def _account_label(account: S3Account) -> str:
        return account.name or account.rgw_account_id or f"Account {account.id}"

    def _list_account_bucket_names(self, account: S3Account) -> list[str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 account credentials are missing.")
        buckets = self.bucket_service.list_buckets(
            account,
            include=set(),
            with_stats=False,
        )
        return [bucket.name for bucket in buckets if bucket.name]

    def build_scope(self, endpoint: StorageEndpoint) -> AdminManagedUsageScope:
        accounts = self.db.scalars(
            select(S3Account)
            .where(S3Account.storage_endpoint_id == endpoint.id)
            .order_by(S3Account.name.asc(), S3Account.id.asc())
        ).all()
        resolved_targets: list[BucketUsageStatsResolvedTarget] = []
        aggregate_targets: list[BucketUsageStatsAggregateTarget] = []
        warnings: list[str] = []
        skipped_account_count = 0
        accounts_with_listed_buckets = 0

        if not accounts:
            warnings.append("No managed S3 accounts are linked to this endpoint.")

        for account in accounts:
            try:
                bucket_names = self._list_account_bucket_names(account)
            except Exception as exc:  # noqa: BLE001
                skipped_account_count += 1
                logger.warning(
                    "Unable to list managed account buckets for usage stats account=%s: %s",
                    account.id,
                    exc,
                )
                if skipped_account_count <= 3:
                    warnings.append(
                        f"{self._account_label(account)} skipped: bucket listing failed."
                    )
                continue

            accounts_with_listed_buckets += 1
            context_id = self._manager_scope_id(account)
            for bucket_name in bucket_names:
                resolved_targets.append(
                    BucketUsageStatsResolvedTarget(
                        context=account,
                        bucket_name=bucket_name,
                        scope_kind="manager",
                        scope_id=context_id,
                        scope_name=account.name,
                        context_id=context_id,
                        context_name=account.name,
                    )
                )
                aggregate_targets.append(
                    BucketUsageStatsAggregateTarget(
                        scope_kind="manager",
                        scope_id=context_id,
                        bucket_name=bucket_name,
                    )
                )

        if skipped_account_count > 0:
            warnings.insert(
                0,
                f"{skipped_account_count} managed account(s) could not be scanned for bucket usage stats.",
            )

        return AdminManagedUsageScope(
            resolved_targets=resolved_targets,
            aggregate_targets=aggregate_targets,
            warnings=warnings,
            managed_account_count=len(accounts),
            accounts_with_listed_buckets=accounts_with_listed_buckets,
            skipped_account_count=skipped_account_count,
        )
