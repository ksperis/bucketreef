# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import StorageEndpoint


class StorageEndpointRepository:
    """Persistence access for required storage endpoints."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if endpoint is None:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        return endpoint
