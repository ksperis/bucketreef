# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Read managed private-access ownership and active provisioning state."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess

ACTIVE_STATES = ("provisioning", "active", "deleting", "cleanup_pending")


class ManagedPrivateAccessQueryService:
    """Centralize read-only queries used to protect managed private resources."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _active_source_statement(source_kind: str, source_id: int):
        return select(ManagedPrivateAccess).where(
            ManagedPrivateAccess.source_context_type == source_kind,
            ManagedPrivateAccess.source_context_id == source_id,
            ManagedPrivateAccess.state.in_(ACTIVE_STATES),
        )

    def managed_iam_user(
        self,
        source_kind: str,
        source_id: int,
        username: str,
    ) -> ManagedPrivateAccess | None:
        return self.db.scalar(
            self._active_source_statement(source_kind, source_id)
            .where(ManagedPrivateAccess.iam_username == username)
            .limit(1)
        )

    def managed_key(
        self,
        source_kind: str,
        source_id: int,
        access_key_id: str,
    ) -> ManagedPrivateAccess | None:
        return self.db.scalar(
            self._active_source_statement(source_kind, source_id)
            .where(ManagedPrivateAccess.access_key_id == access_key_id)
            .limit(1)
        )

    def managed_resources_for_source(
        self,
        source_kind: str,
        source_id: int,
    ) -> list[ManagedPrivateAccess]:
        return list(
            self.db.scalars(
                self._active_source_statement(source_kind, source_id)
            ).all()
        )

    def has_active_source(self, source_kind: str, source_id: int) -> bool:
        return self.db.scalar(
            self._active_source_statement(source_kind, source_id)
            .with_only_columns(ManagedPrivateAccess.id)
            .limit(1)
        ) is not None

    def active_for_source(
        self,
        owner_user_id: int,
        source_kind: str,
        source_id: int,
    ) -> ManagedPrivateAccess | None:
        return self.db.scalar(
            self._active_source_statement(source_kind, source_id)
            .where(ManagedPrivateAccess.owner_user_id == owner_user_id)
            .limit(1)
        )
