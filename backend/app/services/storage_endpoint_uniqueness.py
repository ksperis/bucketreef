# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persistence-level uniqueness checks for storage endpoints."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.db import StorageEndpoint


def _endpoint_exists(
    db: Session,
    criterion: ColumnElement[bool],
    *,
    exclude_id: int | None = None,
) -> bool:
    statement = select(StorageEndpoint.id).where(criterion)
    if exclude_id:
        statement = statement.where(StorageEndpoint.id != exclude_id)
    return db.scalar(statement.limit(1)) is not None


def ensure_unique_storage_endpoint_name(
    db: Session,
    name: str,
    *,
    exclude_id: int | None = None,
) -> None:
    if _endpoint_exists(
        db,
        StorageEndpoint.name == name,
        exclude_id=exclude_id,
    ):
        raise ValueError("An endpoint with this name already exists.")


def ensure_unique_storage_endpoint_url(
    db: Session,
    endpoint_url: str,
    *,
    exclude_id: int | None = None,
) -> None:
    if _endpoint_exists(
        db,
        StorageEndpoint.endpoint_url == endpoint_url,
        exclude_id=exclude_id,
    ):
        raise ValueError("An endpoint with this URL already exists.")
