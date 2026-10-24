# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Optional

from app.services.bucket_migration.workflow import available_actions, preparation_state

from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem
from app.models.bucket_migration import (
    BucketMigrationDetail,
    BucketMigrationEventView,
    BucketMigrationItemView,
    BucketMigrationView,
)


def load_migration_json(value: Optional[str]) -> Optional[dict]:
    if value is None:
        return None
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("Persisted bucket migration JSON must be an object")
    return parsed


def bucket_migration_item_to_view(item: BucketMigrationItem) -> BucketMigrationItemView:
    return BucketMigrationItemView(
        id=item.id,
        source_bucket=item.source_bucket,
        target_bucket=item.target_bucket,
        status=item.status,
        step=item.step,
        read_only_applied=bool(item.read_only_applied),
        target_lock_applied=bool(item.target_lock_applied),
        target_created_by_migration=bool(item.target_created_by_migration),
        recovery_required=bool(item.preparation_effects_json),
        source_deleted=bool(item.source_deleted),
        cleanup_error=item.cleanup_error,
        objects_copied=int(item.objects_copied or 0),
        different_count=item.different_count,
        only_source_count=item.only_source_count,
        only_target_count=item.only_target_count,
        diff_sample=load_migration_json(item.diff_sample_json),
        error_message=item.error_message,
    )


def bucket_migration_event_to_view(entry: BucketMigrationEvent) -> BucketMigrationEventView:
    return BucketMigrationEventView(
        id=entry.id,
        message=entry.message,
        created_at=entry.created_at,
    )


def bucket_migration_to_view(migration: BucketMigration) -> BucketMigrationView:
    return BucketMigrationView(
        id=migration.id,
        source_context_id=migration.source_context_id,
        target_context_id=migration.target_context_id,
        mode=migration.mode,
        copy_bucket_settings=bool(migration.copy_bucket_settings),
        lock_target_writes=bool(migration.lock_target_writes),
        use_same_endpoint_copy=bool(migration.use_same_endpoint_copy),
        auto_grant_source_read_for_copy=bool(migration.auto_grant_source_read_for_copy),
        status=migration.status,
        precheck_status=migration.precheck_status,
        precheck_report=load_migration_json(migration.precheck_report_json),
        precheck_checked_at=migration.precheck_checked_at,
        configuration_revision=migration.configuration_revision,
        preparation_status=preparation_state(migration),
        preparation_active_checks=bool(migration.preparation_active_checks),
        preparation_completed_items=migration.preparation_completed_items,
        maintenance_operation=migration.maintenance_operation,
        maintenance_status=migration.maintenance_status,
        maintenance_error=migration.maintenance_error,
        available_actions=available_actions(migration),
        total_items=int(migration.total_items),
        completed_items=int(migration.completed_items),
        failed_items=int(migration.failed_items),
        skipped_items=int(migration.skipped_items),
        awaiting_items=int(migration.awaiting_items),
        error_message=migration.error_message,
        updated_at=migration.updated_at,
    )


def bucket_migration_to_detail(
    migration: BucketMigration,
    *,
    items: list[BucketMigrationItem],
    recent_events: list[BucketMigrationEvent],
) -> BucketMigrationDetail:
    base = bucket_migration_to_view(migration)
    return BucketMigrationDetail(
        **base.model_dump(),
        items=[bucket_migration_item_to_view(item) for item in items],
        recent_events=[bucket_migration_event_to_view(event) for event in recent_events],
    )
