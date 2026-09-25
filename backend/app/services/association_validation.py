# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session

from app.db.s3_connection import S3Connection


def ensure_association_ids_exist(
    db: Session,
    id_column: Any,
    ids: Iterable[int],
    *,
    entity_label: str,
) -> None:
    requested_ids = {int(item_id) for item_id in ids}
    if not requested_ids:
        return
    found_ids = {
        int(item_id)
        for (item_id,) in db.query(id_column).filter(id_column.in_(requested_ids)).all()
    }
    missing_ids = requested_ids - found_ids
    if missing_ids:
        formatted_ids = ", ".join(str(item_id) for item_id in sorted(missing_ids))
        raise ValueError(f"{entity_label} not found: {formatted_ids}")


def ensure_shared_s3_connections(db: Session, ids: Iterable[int]) -> None:
    requested_ids = {int(connection_id) for connection_id in ids}
    if not requested_ids:
        return
    rows = (
        db.query(S3Connection.id, S3Connection.is_shared)
        .filter(S3Connection.id.in_(requested_ids))
        .all()
    )
    found_ids = {int(connection_id) for connection_id, _ in rows}
    missing_ids = requested_ids - found_ids
    if missing_ids:
        formatted_ids = ", ".join(str(connection_id) for connection_id in sorted(missing_ids))
        raise ValueError(f"S3 connections not found: {formatted_ids}")
    non_shared_ids = sorted(
        int(connection_id)
        for connection_id, is_shared in rows
        if not bool(is_shared)
    )
    if non_shared_ids:
        formatted_ids = ", ".join(str(connection_id) for connection_id in non_shared_ids)
        raise ValueError(f"Only shared S3 connections can be linked: {formatted_ids}")
