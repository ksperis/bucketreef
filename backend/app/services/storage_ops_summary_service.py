# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import S3Connection, User
from app.models.storage_ops import StorageOpsSummary
from app.services.storage_ops_context_service import list_storage_ops_context_refs


def _connection_id_from_context_id(context_id: str) -> int | None:
    if not context_id.startswith("conn-"):
        return None
    suffix = context_id.removeprefix("conn-")
    return int(suffix) if suffix.isdigit() else None


class StorageOpsSummaryService:
    """Build the Storage Ops summary from the effective context catalogue."""

    def __init__(self, db: Session):
        self.db = db

    def build(self, user: User) -> StorageOpsSummary:
        refs = list_storage_ops_context_refs(user, self.db)
        account_count = 0
        s3_user_count = 0
        connection_ids: set[int] = set()
        endpoint_ids: set[int] = set()
        endpoint_names: set[str] = set()

        for ref in refs:
            if ref.endpoint_id is not None:
                endpoint_ids.add(ref.endpoint_id)
            elif ref.endpoint_name:
                endpoint_names.add(ref.endpoint_name)

            if ref.context_kind == "account":
                account_count += 1
                continue
            if ref.context_kind == "s3_user":
                s3_user_count += 1
                continue

            connection_id = _connection_id_from_context_id(ref.context_id)
            if connection_id is not None:
                connection_ids.add(connection_id)

        shared_connection_count = self._shared_connection_count(connection_ids)
        connection_count = len(connection_ids)
        return StorageOpsSummary(
            total_contexts=account_count + s3_user_count + connection_count,
            total_accounts=account_count,
            total_s3_users=s3_user_count,
            total_connections=connection_count,
            total_shared_connections=shared_connection_count,
            total_private_connections=max(connection_count - shared_connection_count, 0),
            total_endpoints=len(endpoint_ids) + len(endpoint_names),
        )

    def _shared_connection_count(self, connection_ids: set[int]) -> int:
        if not connection_ids:
            return 0
        shared_flags = self.db.scalars(
            select(S3Connection.is_shared).where(
                S3Connection.id.in_(connection_ids)
            )
        )
        return sum(1 for is_shared in shared_flags if bool(is_shared))
