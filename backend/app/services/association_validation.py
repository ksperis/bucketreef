# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.db import User
from app.db.s3_connection import S3Connection


def _normalized_ids(ids: Iterable[int]) -> set[int]:
    return {int(item_id) for item_id in ids}


def _format_ids(ids: Iterable[int]) -> str:
    return ", ".join(str(item_id) for item_id in sorted(ids))


def load_association_users(
    db: Session,
    ids: Iterable[int],
    *,
    entity_label: str = "Users",
) -> dict[int, User]:
    requested_ids = _normalized_ids(ids)
    if not requested_ids:
        return {}
    users = db.scalars(select(User).where(User.id.in_(requested_ids))).all()
    users_by_id = {int(user.id): user for user in users}
    missing_ids = requested_ids - set(users_by_id)
    if missing_ids:
        raise ValueError(f"{entity_label} not found: {_format_ids(missing_ids)}")
    return users_by_id


def ensure_association_ids_exist(
    db: Session,
    id_column: InstrumentedAttribute[int],
    ids: Iterable[int],
    *,
    entity_label: str,
) -> None:
    requested_ids = _normalized_ids(ids)
    if not requested_ids:
        return
    found_ids = {
        int(item_id)
        for item_id in db.scalars(select(id_column).where(id_column.in_(requested_ids))).all()
    }
    missing_ids = requested_ids - found_ids
    if missing_ids:
        raise ValueError(f"{entity_label} not found: {_format_ids(missing_ids)}")


def ensure_shared_s3_connections(db: Session, ids: Iterable[int]) -> None:
    requested_ids = _normalized_ids(ids)
    if not requested_ids:
        return
    rows = db.execute(
        select(S3Connection.id, S3Connection.is_shared).where(
            S3Connection.id.in_(requested_ids)
        )
    ).all()
    found_ids = {int(connection_id) for connection_id, _ in rows}
    missing_ids = requested_ids - found_ids
    if missing_ids:
        raise ValueError(f"S3 connections not found: {_format_ids(missing_ids)}")
    non_shared_ids = sorted(
        int(connection_id)
        for connection_id, is_shared in rows
        if not bool(is_shared)
    )
    if non_shared_ids:
        raise ValueError(
            f"Only shared S3 connections can be linked: {_format_ids(non_shared_ids)}"
        )
