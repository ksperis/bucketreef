# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy import or_, select, update

from app.db import BucketMigration
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.time import utcnow

from .workflow import ACTIVE_STATUSES

logger = logging.getLogger(__name__)


class BucketMigrationSchedulingMixin:
    def claim_next_runnable_migration_id(
        self, *, worker_id: str, lease_seconds: int
    ) -> Optional[int]:
        if not worker_id:
            raise ValueError("worker_id is required to claim a migration lease")
        now = utcnow()
        lease_duration = max(15, int(lease_seconds))
        lease_until = now + timedelta(seconds=lease_duration)
        limits = self._load_runtime_limits()
        max_active_per_endpoint = max(1, int(limits.max_active_per_endpoint))
        endpoint_usage = self._active_endpoint_usage(now=now)
        endpoint_cache: dict[str, str] = {}
        candidate_rows = self.db.execute(
            select(
                BucketMigration.id,
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            )
            .where(
                or_(
                    BucketMigration.status.in_(ACTIVE_STATUSES),
                    BucketMigration.maintenance_status.in_({"queued", "running"}),
                ),
                or_(
                    BucketMigration.worker_lease_until.is_(None),
                    BucketMigration.worker_lease_until < now,
                ),
            )
            .order_by(BucketMigration.created_at.asc())
            .limit(50)
        ).all()
        for row in candidate_rows:
            migration_id = int(row.id)
            endpoint_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=endpoint_cache,
            )
            if any(
                endpoint_usage.get(key, 0) >= max_active_per_endpoint
                for key in endpoint_keys
            ):
                continue
            updated = self.db.execute(
                update(BucketMigration)
                .where(
                    BucketMigration.id == migration_id,
                    or_(
                        BucketMigration.status.in_(ACTIVE_STATUSES),
                        BucketMigration.maintenance_status.in_({"queued", "running"}),
                    ),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .values(
                    {
                        BucketMigration.worker_lease_owner: worker_id,
                        BucketMigration.worker_lease_until: lease_until,
                        BucketMigration.updated_at: now,
                    }
                )
                .execution_options(synchronize_session=False)
            ).rowcount
            if updated == 1:
                self._commit()
                if self._claimed_migration_within_endpoint_limit(
                    migration_id,
                    endpoint_keys=endpoint_keys,
                    max_active_per_endpoint=max_active_per_endpoint,
                    now=utcnow(),
                    cache=endpoint_cache,
                ):
                    return migration_id
                logger.info(
                    "Bucket migration claim released after endpoint limit recheck: migration=%s worker=%s",
                    migration_id,
                    worker_id,
                )
                self._release_migration_lease(migration_id, worker_id=worker_id)
                self._commit()
                endpoint_usage = self._active_endpoint_usage(now=utcnow())
                continue
            self.db.rollback()
        return None

    def _active_endpoint_usage(self, *, now) -> dict[str, int]:
        usage: dict[str, int] = {}
        cache: dict[str, str] = {}
        rows = self.db.execute(
            select(
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            ).where(
                or_(
                    BucketMigration.status.in_(ACTIVE_STATUSES),
                    BucketMigration.maintenance_status.in_({"queued", "running"}),
                ),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
        ).all()
        for row in rows:
            for key in self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            ):
                usage[key] = usage.get(key, 0) + 1
        return usage

    def _claimed_migration_within_endpoint_limit(
        self,
        migration_id: int,
        *,
        endpoint_keys: set[str],
        max_active_per_endpoint: int,
        now,
        cache: dict[str, str],
    ) -> bool:
        if not endpoint_keys:
            return True
        allowed_per_endpoint = max(1, int(max_active_per_endpoint))
        rows = self.db.execute(
            select(
                BucketMigration.id,
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            )
            .where(
                or_(
                    BucketMigration.status.in_(ACTIVE_STATUSES),
                    BucketMigration.maintenance_status.in_({"queued", "running"}),
                ),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
            .order_by(BucketMigration.created_at.asc(), BucketMigration.id.asc())
        ).all()
        ranked_by_endpoint: dict[str, list[int]] = {}
        for row in rows:
            row_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            )
            for key in row_keys:
                ranked_by_endpoint.setdefault(key, []).append(int(row.id))
        for key in endpoint_keys:
            ranked_ids = ranked_by_endpoint.get(key, [])
            if migration_id not in ranked_ids:
                return False
            if ranked_ids.index(migration_id) >= allowed_per_endpoint:
                return False
        return True

    def _endpoint_keys_for_contexts(
        self,
        source_context_id: str,
        target_context_id: str,
        *,
        cache: dict[str, str],
    ) -> set[str]:
        source_key = self._context_endpoint_capacity_key(source_context_id, cache=cache)
        target_key = self._context_endpoint_capacity_key(target_context_id, cache=cache)
        keys = {source_key, target_key}
        return {key for key in keys if key}

    def _context_endpoint_capacity_key(
        self,
        context_id: str,
        *,
        cache: dict[str, str],
    ) -> str:
        normalized_context_id = (context_id or "").strip()
        if not normalized_context_id:
            return "context:unknown"
        cached = cache.get(normalized_context_id)
        if cached is not None:
            return cached
        endpoint_key = f"context:{normalized_context_id}"
        try:
            ctx = self._resolve_context(normalized_context_id)
            endpoint = normalize_s3_endpoint(ctx.endpoint)
            if endpoint:
                endpoint_key = f"endpoint:{endpoint}"
        except Exception:
            logger.debug(
                "Unable to resolve endpoint for migration context '%s' while evaluating endpoint limits.",
                normalized_context_id,
                exc_info=True,
            )
        cache[normalized_context_id] = endpoint_key
        return endpoint_key
