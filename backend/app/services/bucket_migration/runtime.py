# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem
from app.models.access_context import BucketMigrationAccessScope
from app.services.bucket_migration.worker import get_bucket_migration_worker
from app.services.bucket_migration_service import BucketMigrationService


def build_bucket_migration_service(
    db: Session,
    scope: BucketMigrationAccessScope,
) -> BucketMigrationService:
    return BucketMigrationService(
        db,
        authorized_context_ids=scope.allowed_context_ids,
        admin_account_context_ids=scope.admin_account_context_ids,
    )


def wake_bucket_migration_worker() -> None:
    get_bucket_migration_worker(SessionLocal).wake_up()


def migration_stream_signature(
    db: Session,
    migration_id: int,
    *,
    migration: BucketMigration | None = None,
) -> tuple[str, str, int]:
    max_item_updated_at = db.scalar(
        select(func.max(BucketMigrationItem.updated_at)).where(
            BucketMigrationItem.migration_id == migration_id
        )
    )
    max_event_id = db.scalar(
        select(func.max(BucketMigrationEvent.id)).where(
            BucketMigrationEvent.migration_id == migration_id
        )
    )
    migration_updated_at = migration.updated_at if migration is not None else None
    return (
        migration_updated_at.isoformat() if migration_updated_at else "",
        max_item_updated_at.isoformat() if max_item_updated_at else "",
        int(max_event_id or 0),
    )
