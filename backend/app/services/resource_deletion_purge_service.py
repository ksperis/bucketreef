# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import (
    BillingAssignment,
    BillingRateCard,
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

    def _execution_context_migrations(self, context_id: str):
        return (
            self.db.query(
                BucketMigration.id,
                BucketMigration.status,
                BucketMigration.preparation_status,
                BucketMigration.maintenance_status,
            )
            .filter(
                or_(
                    BucketMigration.source_context_id == context_id,
                    BucketMigration.target_context_id == context_id,
                )
            )
            .all()
        )

    def validate_execution_context_cleanup(self, context_id: str) -> None:
        """Reject resource deletion while a migration cannot be safely discarded."""
        for migration in self._execution_context_migrations(context_id):
            busy = (
                migration.status in ACTIVE_STATUSES
                or migration.preparation_status == "checking"
                or migration.maintenance_status in {"queued", "running"}
            )
            protected = (
                self.db.query(BucketMigrationItem.id)
                .filter(
                    BucketMigrationItem.migration_id == migration.id,
                    or_(
                        BucketMigrationItem.preparation_effects_json.is_not(None),
                        BucketMigrationItem.read_only_applied.is_(True),
                        BucketMigrationItem.target_lock_applied.is_(True),
                    ),
                )
                .first()
                is not None
            )
            if busy or migration.status not in {*_FINAL_MIGRATION_STATUSES, "draft"} or protected:
                raise ValueError(
                    f"Execution context {context_id} is still used by bucket migration "
                    f"{migration.id}, which cannot be deleted safely in its current state"
                )

    def purge_execution_context_data(self, context_id: str) -> None:
        """Delete local data whose identity is the removed execution context."""
        self.validate_execution_context_cleanup(context_id)
        self.db.query(BrowserFavorite).filter(BrowserFavorite.context == context_id).delete(
            synchronize_session=False
        )
        self.db.query(BucketUsageStatsSnapshot).filter(
            BucketUsageStatsSnapshot.scope_kind == "manager",
            BucketUsageStatsSnapshot.scope_id == context_id,
        ).delete(synchronize_session=False)
        migration_ids = [migration.id for migration in self._execution_context_migrations(context_id)]
        if migration_ids:
            self.db.query(BucketMigrationEvent).filter(
                BucketMigrationEvent.migration_id.in_(migration_ids)
            ).delete(synchronize_session=False)
            self.db.query(BucketMigrationItem).filter(
                BucketMigrationItem.migration_id.in_(migration_ids)
            ).delete(synchronize_session=False)
            self.db.query(BucketMigration).filter(BucketMigration.id.in_(migration_ids)).delete(
                synchronize_session=False
            )

    def purge_account_derived_data(self, account_id: int) -> None:
        self.db.query(BillingAssignment).filter(BillingAssignment.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingUsageDaily).filter(BillingUsageDaily.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingStorageDaily).filter(BillingStorageDaily.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaAlertState).filter(QuotaAlertState.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageHourly).filter(QuotaUsageHourly.s3_account_id == account_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageDaily).filter(QuotaUsageDaily.s3_account_id == account_id).delete(
            synchronize_session=False
        )

    def purge_s3_user_derived_data(self, s3_user_id: int) -> None:
        self.db.query(BillingAssignment).filter(BillingAssignment.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingUsageDaily).filter(BillingUsageDaily.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingStorageDaily).filter(BillingStorageDaily.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaAlertState).filter(QuotaAlertState.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageHourly).filter(QuotaUsageHourly.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageDaily).filter(QuotaUsageDaily.s3_user_id == s3_user_id).delete(
            synchronize_session=False
        )

    def purge_endpoint_derived_data(self, endpoint_id: int) -> None:
        self.db.query(BillingAssignment).filter(BillingAssignment.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingUsageDaily).filter(BillingUsageDaily.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingStorageDaily).filter(BillingStorageDaily.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BillingRateCard).filter(BillingRateCard.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaAlertState).filter(QuotaAlertState.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageHourly).filter(QuotaUsageHourly.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(QuotaUsageDaily).filter(QuotaUsageDaily.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(BucketUsageStatsSnapshot).filter(
            BucketUsageStatsSnapshot.scope_kind.in_(("admin_managed", "ceph_admin")),
            BucketUsageStatsSnapshot.scope_id == str(endpoint_id),
        ).delete(synchronize_session=False)
        self.purge_endpoint_healthchecks(endpoint_id)

    def purge_endpoint_healthchecks(self, endpoint_id: int) -> None:
        self.db.query(EndpointHealthCheck).filter(EndpointHealthCheck.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(EndpointHealthLatest).filter(EndpointHealthLatest.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
        self.db.query(EndpointHealthStatusSegment).filter(
            EndpointHealthStatusSegment.storage_endpoint_id == endpoint_id
        ).delete(synchronize_session=False)
        self.db.query(EndpointHealthRollup).filter(EndpointHealthRollup.storage_endpoint_id == endpoint_id).delete(
            synchronize_session=False
        )
