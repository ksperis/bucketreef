# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem
from app.models.access_context import BucketMigrationAccessScope
from app.models.bucket_migration import BucketMigrationDetail
from app.services.mappers.bucket_migration import bucket_migration_to_detail
from app.services.bucket_migration.worker import get_bucket_migration_worker
from app.services.bucket_migration_service import BucketMigrationService


MigrationStreamSignature = tuple[str, str, int]


@dataclass(frozen=True)
class BucketMigrationStreamSnapshot:
    signature: MigrationStreamSignature
    detail: BucketMigrationDetail | None


def build_bucket_migration_service(
    db: Session,
    scope: BucketMigrationAccessScope,
) -> BucketMigrationService:
    return BucketMigrationService(
        db,
        authorized_context_ids=scope.allowed_context_ids,
        admin_account_context_ids=scope.admin_account_context_ids,
        execution_auth_session_id=scope.auth_session_id,
    )


def wake_bucket_migration_worker() -> None:
    get_bucket_migration_worker(SessionLocal).wake_up()


def migration_stream_signature(
    db: Session,
    migration_id: int,
    *,
    migration: BucketMigration | None = None,
) -> MigrationStreamSignature:
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


def load_migration_stream_snapshot(
    db: Session,
    scope: BucketMigrationAccessScope,
    migration_id: int,
    *,
    events_limit: int,
    previous_signature: MigrationStreamSignature | None = None,
) -> BucketMigrationStreamSnapshot:
    """Load one authorized migration stream poll and project changed state."""
    service = build_bucket_migration_service(db, scope)
    migration = service.get_migration(migration_id)
    signature = migration_stream_signature(db, migration_id, migration=migration)
    if signature == previous_signature:
        return BucketMigrationStreamSnapshot(signature=signature, detail=None)

    items = service.list_migration_items(migration.id)
    recent_events = service.list_recent_migration_events(
        migration.id,
        limit=events_limit,
    )
    return BucketMigrationStreamSnapshot(
        signature=signature,
        detail=bucket_migration_to_detail(
            migration,
            items=items,
            recent_events=recent_events,
        ),
    )
