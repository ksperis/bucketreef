# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_enums import StorageProvider
from app.core.domain_errors import StorageEndpointProviderError
from app.db import S3Account, StorageEndpoint
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsResolvedTarget,
)
from app.services.buckets_service import BucketsService
from app.services.s3_client import S3OperationError
from app.services.s3_execution_context import ResolvedS3BucketTarget, S3ExecutionContext
from app.services.storage_endpoint_repository import StorageEndpointRepository


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
        self.endpoints = StorageEndpointRepository(db)
        self.bucket_service = bucket_service

    def resolve_ceph_endpoint(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.endpoints.get(endpoint_id)
        if endpoint.provider != StorageProvider.CEPH.value:
            raise StorageEndpointProviderError("This endpoint is not a Ceph endpoint.")
        return endpoint

    @staticmethod
    def _account_context(account: S3Account, endpoint: StorageEndpoint) -> S3ExecutionContext:
        account_id = account.id
        if not isinstance(account_id, int) or account_id <= 0:
            raise ValueError("Managed S3 account is missing a local identifier.")
        return S3ExecutionContext(
            context_id=str(account_id),
            context_kind="account",
            name=account.name,
            access_key=account.rgw_access_key,
            secret_key=account.rgw_secret_key,
            id=account_id,
            rgw_account_id=account.rgw_account_id,
            email=account.email,
            rgw_user_uid=account.rgw_user_uid,
            rgw_tenant=account.rgw_tenant,
            storage_endpoint_id=account.storage_endpoint_id,
            session_endpoint=endpoint.endpoint_url,
            session_region=endpoint.region,
            session_force_path_style=bool(endpoint.force_path_style),
            session_verify_tls=bool(endpoint.verify_tls),
        )

    @staticmethod
    def _account_label(context: S3ExecutionContext) -> str:
        return context.name or context.rgw_account_id or f"Account {context.id}"

    def _load_account_contexts(self, endpoint: StorageEndpoint) -> list[S3ExecutionContext]:
        try:
            accounts = self.db.scalars(
                select(S3Account)
                .where(S3Account.storage_endpoint_id == endpoint.id)
                .order_by(S3Account.name.asc(), S3Account.id.asc())
            ).all()
            return [self._account_context(account, endpoint) for account in accounts]
        finally:
            self.db.rollback()

    def _list_account_bucket_names(self, context: S3ExecutionContext) -> list[str]:
        buckets = self.bucket_service.list_buckets(
            context,
            include=set(),
            with_stats=False,
        )
        return [bucket.name for bucket in buckets if bucket.name]

    def _account_usage_targets(
        self,
        context: S3ExecutionContext,
        bucket_names: list[str],
    ) -> tuple[
        list[BucketUsageStatsResolvedTarget],
        list[BucketUsageStatsAggregateTarget],
    ]:
        context_id = context.context_id
        resolved_targets = [
            BucketUsageStatsResolvedTarget.from_bucket_target(
                ResolvedS3BucketTarget.from_context(context, bucket_name),
                scope_kind="manager",
                scope_id=context_id,
                scope_name=context.name,
            )
            for bucket_name in bucket_names
        ]
        aggregate_targets = [
            BucketUsageStatsAggregateTarget(
                scope_kind="manager",
                scope_id=context_id,
                bucket_name=bucket_name,
            )
            for bucket_name in bucket_names
        ]
        return resolved_targets, aggregate_targets

    def build_scope(self, endpoint: StorageEndpoint) -> AdminManagedUsageScope:
        contexts = self._load_account_contexts(endpoint)
        resolved_targets: list[BucketUsageStatsResolvedTarget] = []
        aggregate_targets: list[BucketUsageStatsAggregateTarget] = []
        warnings: list[str] = []
        skipped_account_count = 0
        accounts_with_listed_buckets = 0

        if not contexts:
            warnings.append("No managed S3 accounts are linked to this endpoint.")

        for context in contexts:
            try:
                bucket_names = self._list_account_bucket_names(context)
            except S3OperationError as exc:
                skipped_account_count += 1
                logger.warning(
                    "Unable to list managed account buckets for usage stats account=%s: %s",
                    context.id,
                    exc,
                )
                if skipped_account_count <= 3:
                    warnings.append(
                        f"{self._account_label(context)} skipped: bucket listing failed."
                    )
                continue

            accounts_with_listed_buckets += 1
            account_resolved, account_aggregate = self._account_usage_targets(
                context,
                bucket_names,
            )
            resolved_targets.extend(account_resolved)
            aggregate_targets.extend(account_aggregate)

        if skipped_account_count > 0:
            warnings.insert(
                0,
                f"{skipped_account_count} managed account(s) could not be scanned for bucket usage stats.",
            )

        return AdminManagedUsageScope(
            resolved_targets=resolved_targets,
            aggregate_targets=aggregate_targets,
            warnings=warnings,
            managed_account_count=len(contexts),
            accounts_with_listed_buckets=accounts_with_listed_buckets,
            skipped_account_count=skipped_account_count,
        )
