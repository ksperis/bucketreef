# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.db import (
    BillingAssignment,
    BillingRateCard,
    BillingRatePlan,
    BillingStorageDaily,
    BillingUsageDaily,
    BrowserFavorite,
    BucketMigration,
    BucketMigrationEvent,
    BucketMigrationItem,
    BucketUsageStatsSnapshot,
    EndpointHealthCheck,
    EndpointHealthLatest,
    EndpointHealthRollup,
    EndpointHealthStatusSegment,
    QuotaAlertState,
    QuotaUsageDaily,
    QuotaUsageHourly,
)
from app.services.bucket_migration._shared import _FINAL_MIGRATION_STATUSES
from app.services.bucket_migration.workflow import ACTIVE_STATUSES


class ResourceDeletionPurgeService:
    """Hard-delete derived database rows before removing their owning resource."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def _delete_where(self, model, *criteria) -> None:
        self.db.execute(
            delete(model).where(*criteria).execution_options(synchronize_session=False)
        )

    def _execution_context_migrations(self, context_id: str):
        return self.db.execute(
            select(
                BucketMigration.id,
                BucketMigration.status,
                BucketMigration.preparation_status,
                BucketMigration.maintenance_status,
            )
            .where(
                or_(
                    BucketMigration.source_context_id == context_id,
                    BucketMigration.target_context_id == context_id,
                )
            )
        ).all()

    def validate_execution_context_cleanup(self, context_id: str) -> None:
        """Reject resource deletion while a migration cannot be safely discarded."""
        for migration in self._execution_context_migrations(context_id):
            busy = (
                migration.status in ACTIVE_STATUSES
                or migration.preparation_status == "checking"
                or migration.maintenance_status in {"queued", "running"}
            )
            protected = self.db.scalar(
                select(BucketMigrationItem.id)
                .where(
                    BucketMigrationItem.migration_id == migration.id,
                    or_(
                        BucketMigrationItem.preparation_effects_json.is_not(None),
                        BucketMigrationItem.read_only_applied.is_(True),
                        BucketMigrationItem.target_lock_applied.is_(True),
                    ),
                )
                .limit(1)
            ) is not None
            if busy or migration.status not in {*_FINAL_MIGRATION_STATUSES, "draft"} or protected:
                raise ValueError(
                    f"Execution context {context_id} is still used by bucket migration "
                    f"{migration.id}, which cannot be deleted safely in its current state"
                )

    def purge_execution_context_data(self, context_id: str) -> None:
        """Delete local data whose identity is the removed execution context."""
        self.validate_execution_context_cleanup(context_id)
        self._delete_where(BrowserFavorite, BrowserFavorite.context == context_id)
        self._delete_where(
            BucketUsageStatsSnapshot,
            BucketUsageStatsSnapshot.scope_kind == "manager",
            BucketUsageStatsSnapshot.scope_id == context_id,
        )
        migration_ids = [migration.id for migration in self._execution_context_migrations(context_id)]
        if migration_ids:
            self._delete_where(BucketMigrationEvent, BucketMigrationEvent.migration_id.in_(migration_ids))
            self._delete_where(BucketMigrationItem, BucketMigrationItem.migration_id.in_(migration_ids))
            self._delete_where(BucketMigration, BucketMigration.id.in_(migration_ids))

    def purge_account_derived_data(self, account_id: int) -> None:
        self._delete_where(BillingAssignment, BillingAssignment.s3_account_id == account_id)
        self._delete_where(BillingUsageDaily, BillingUsageDaily.s3_account_id == account_id)
        self._delete_where(BillingStorageDaily, BillingStorageDaily.s3_account_id == account_id)
        self._delete_where(QuotaAlertState, QuotaAlertState.s3_account_id == account_id)
        self._delete_where(QuotaUsageHourly, QuotaUsageHourly.s3_account_id == account_id)
        self._delete_where(QuotaUsageDaily, QuotaUsageDaily.s3_account_id == account_id)

    def purge_s3_user_derived_data(self, s3_user_id: int) -> None:
        self._delete_where(BillingAssignment, BillingAssignment.s3_user_id == s3_user_id)
        self._delete_where(BillingUsageDaily, BillingUsageDaily.s3_user_id == s3_user_id)
        self._delete_where(BillingStorageDaily, BillingStorageDaily.s3_user_id == s3_user_id)
        self._delete_where(QuotaAlertState, QuotaAlertState.s3_user_id == s3_user_id)
        self._delete_where(QuotaUsageHourly, QuotaUsageHourly.s3_user_id == s3_user_id)
        self._delete_where(QuotaUsageDaily, QuotaUsageDaily.s3_user_id == s3_user_id)

    def purge_endpoint_derived_data(self, endpoint_id: int) -> None:
        self._delete_where(BillingAssignment, BillingAssignment.storage_endpoint_id == endpoint_id)
        self._delete_where(BillingUsageDaily, BillingUsageDaily.storage_endpoint_id == endpoint_id)
        self._delete_where(BillingStorageDaily, BillingStorageDaily.storage_endpoint_id == endpoint_id)
        endpoint_rate_plan_ids = select(BillingRatePlan.id).where(
            BillingRatePlan.storage_endpoint_id == endpoint_id
        )
        self._delete_where(BillingRateCard, BillingRateCard.rate_plan_id.in_(endpoint_rate_plan_ids))
        self._delete_where(BillingRatePlan, BillingRatePlan.storage_endpoint_id == endpoint_id)
        self._delete_where(QuotaAlertState, QuotaAlertState.storage_endpoint_id == endpoint_id)
        self._delete_where(QuotaUsageHourly, QuotaUsageHourly.storage_endpoint_id == endpoint_id)
        self._delete_where(QuotaUsageDaily, QuotaUsageDaily.storage_endpoint_id == endpoint_id)
        self._delete_where(
            BucketUsageStatsSnapshot,
            BucketUsageStatsSnapshot.scope_kind.in_(("admin_managed", "ceph_admin")),
            BucketUsageStatsSnapshot.scope_id == str(endpoint_id),
        )
        self.purge_endpoint_healthchecks(endpoint_id)

    def purge_endpoint_healthchecks(self, endpoint_id: int) -> None:
        self._delete_where(EndpointHealthCheck, EndpointHealthCheck.storage_endpoint_id == endpoint_id)
        self._delete_where(EndpointHealthLatest, EndpointHealthLatest.storage_endpoint_id == endpoint_id)
        self._delete_where(
            EndpointHealthStatusSegment,
            EndpointHealthStatusSegment.storage_endpoint_id == endpoint_id,
        )
        self._delete_where(EndpointHealthRollup, EndpointHealthRollup.storage_endpoint_id == endpoint_id)
