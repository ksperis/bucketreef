# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import StorageEndpoint
from app.utils.name_ordering import name_order_by


class StorageEndpointRepository:
    """Persistence access for required storage endpoints."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if endpoint is None:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        return endpoint

    def get_default(self) -> Optional[StorageEndpoint]:
        return self.db.scalar(
            select(StorageEndpoint)
            .where(StorageEndpoint.is_default.is_(True))
            .order_by(StorageEndpoint.id.asc())
            .limit(1)
        )

    def get_default_or_first(self) -> Optional[StorageEndpoint]:
        return self.db.scalar(
            select(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .limit(1)
        )

    def list_ordered(self) -> list[StorageEndpoint]:
        return list(
            self.db.scalars(
                select(StorageEndpoint).order_by(*name_order_by(StorageEndpoint))
            )
        )

    def find_by_url(self, endpoint_url: str) -> Optional[StorageEndpoint]:
        return self.db.scalar(
            select(StorageEndpoint)
            .where(StorageEndpoint.endpoint_url == endpoint_url)
            .limit(1)
        )
