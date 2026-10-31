# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import or_, select

from app.core.domain_errors import BucketMigrationNotFoundError
from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem


class BucketMigrationQueryMixin:
    def list_migrations(
        self, limit: int = 100, *, context_id: Optional[str] = None
    ) -> list[BucketMigration]:
        if (
            self._authorized_context_ids is not None
            and not self._authorized_context_ids
        ):
            return []
        statement = select(BucketMigration)
        if self._authorized_context_ids is not None:
            statement = statement.where(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        normalized_context_id = (context_id or "").strip()
        if normalized_context_id:
            if (
                self._authorized_context_ids is not None
                and normalized_context_id not in self._authorized_context_ids
            ):
                return []
            statement = statement.where(
                or_(
                    BucketMigration.source_context_id == normalized_context_id,
                    BucketMigration.target_context_id == normalized_context_id,
                )
            )
        return self.db.scalars(
            statement.order_by(BucketMigration.created_at.desc()).limit(
                max(1, min(int(limit), 500))
            )
        ).all()

    def get_migration(self, migration_id: int) -> BucketMigration:
        statement = select(BucketMigration).where(BucketMigration.id == migration_id)
        if self._authorized_context_ids is not None:
            if not self._authorized_context_ids:
                raise BucketMigrationNotFoundError("Migration not found")
            statement = statement.where(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        migration = self.db.scalars(statement).first()
        if not migration:
            raise BucketMigrationNotFoundError("Migration not found")
        return migration

    def list_migration_items(self, migration_id: int) -> list[BucketMigrationItem]:
        migration = self.get_migration(migration_id)
        return self.db.scalars(
            select(BucketMigrationItem)
            .where(BucketMigrationItem.migration_id == migration.id)
            .order_by(BucketMigrationItem.id.asc())
        ).all()

    def list_recent_migration_events(
        self, migration_id: int, *, limit: int
    ) -> list[BucketMigrationEvent]:
        migration = self.get_migration(migration_id)
        safe_limit = max(1, min(int(limit), 1000))
        return self.db.scalars(
            select(BucketMigrationEvent)
            .where(BucketMigrationEvent.migration_id == migration.id)
            .order_by(
                BucketMigrationEvent.created_at.desc(), BucketMigrationEvent.id.desc()
            )
            .limit(safe_limit)
        ).all()
