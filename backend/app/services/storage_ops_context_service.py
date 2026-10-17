# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import User
from app.models.execution_context import ExecutionContext
from app.services.execution_context_catalog_service import ExecutionContextCatalogService
from app.services.storage_ops_bucket_listing_service import (
    StorageOpsContextRef,
    build_storage_ops_context_refs,
)


def list_storage_ops_contexts(user: User, db: Session) -> list[ExecutionContext]:
    """Return the effective Manager contexts exposed to Storage Ops."""

    return ExecutionContextCatalogService(db).list_contexts(
        user,
        workspace="manager",
    )


def list_storage_ops_context_refs(user: User, db: Session) -> list[StorageOpsContextRef]:
    return build_storage_ops_context_refs(list_storage_ops_contexts(user, db))


def storage_ops_context_names(user: User, db: Session) -> dict[str, str]:
    return {
        context.id: context.display_name
        for context in list_storage_ops_contexts(user, db)
    }
