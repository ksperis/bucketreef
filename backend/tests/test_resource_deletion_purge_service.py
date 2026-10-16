# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.db import (
    BrowserFavorite,
    BucketMigration,
    BucketMigrationEvent,
    BucketMigrationItem,
    BucketUsageStatsSnapshot,
    User,
    UserRole,
)
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService


def _seed_user(db_session) -> User:
    user = User(
        email="context-cleanup@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _snapshot(context_id: str, bucket_name: str) -> BucketUsageStatsSnapshot:
    return BucketUsageStatsSnapshot(
        scope_kind="manager",
        scope_id=context_id,
        bucket_name=bucket_name,
        data_type_distribution_json="[]",
        storage_class_distribution_json="[]",
        size_distribution_json="[]",
        age_distribution_json="[]",
        current_noncurrent_distribution_json="[]",
    )


def test_purge_execution_context_data_removes_local_dependents(db_session):
    user = _seed_user(db_session)
    context_id = "conn-42"
    migration = BucketMigration(
        created_by_user_id=user.id,
        source_context_id=context_id,
        target_context_id="conn-43",
        status="draft",
    )
    migration.items.append(BucketMigrationItem(source_bucket="source", target_bucket="target"))
    migration.events.append(BucketMigrationEvent(level="info", message="Draft created"))
    db_session.add_all(
        [
            BrowserFavorite(
                id="11111111-1111-1111-1111-111111111111",
                user_id=user.id,
                surface="browser",
                name="Removed favorite",
                workspace="manager",
                context=context_id,
                bucket="source",
                prefix="",
                revision=1,
            ),
            BrowserFavorite(
                id="22222222-2222-2222-2222-222222222222",
                user_id=user.id,
                surface="browser",
                name="Kept favorite",
                workspace="manager",
                context="conn-99",
                bucket="other",
                prefix="",
                revision=1,
            ),
            _snapshot(context_id, "source"),
            _snapshot("conn-99", "other"),
            migration,
        ]
    )
    db_session.commit()
    migration_id = migration.id

    purge = ResourceDeletionPurgeService(db_session)
    purge.validate_execution_context_cleanup(context_id)
    purge.purge_execution_context_data(context_id)
    db_session.commit()

    assert db_session.query(BrowserFavorite).filter(BrowserFavorite.context == context_id).count() == 0
    assert (
        db_session.query(BucketUsageStatsSnapshot)
        .filter(BucketUsageStatsSnapshot.scope_kind == "manager", BucketUsageStatsSnapshot.scope_id == context_id)
        .count()
        == 0
    )
    assert db_session.query(BucketMigration).filter(BucketMigration.id == migration_id).first() is None
    assert db_session.query(BucketMigrationItem).filter(BucketMigrationItem.migration_id == migration_id).count() == 0
    assert db_session.query(BucketMigrationEvent).filter(BucketMigrationEvent.migration_id == migration_id).count() == 0
    assert db_session.query(BrowserFavorite).filter(BrowserFavorite.context == "conn-99").count() == 1
    assert (
        db_session.query(BucketUsageStatsSnapshot)
        .filter(BucketUsageStatsSnapshot.scope_kind == "manager", BucketUsageStatsSnapshot.scope_id == "conn-99")
        .count()
        == 1
    )


def test_validate_execution_context_cleanup_rejects_non_deletable_migration(db_session):
    user = _seed_user(db_session)
    migration = BucketMigration(
        created_by_user_id=user.id,
        source_context_id="s3u-7",
        target_context_id="conn-8",
        status="running",
    )
    migration.items.append(BucketMigrationItem(source_bucket="source", target_bucket="target"))
    db_session.add(migration)
    db_session.commit()

    with pytest.raises(ValueError, match=rf"bucket migration {migration.id}"):
        ResourceDeletionPurgeService(db_session).validate_execution_context_cleanup("s3u-7")

    assert db_session.query(BucketMigration).filter(BucketMigration.id == migration.id).one()
