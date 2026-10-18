# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import InstrumentedAttribute, Session
from sqlalchemy.sql.elements import ColumnElement

from app.db import S3Connection, S3User


def _load_names(
    db: Session,
    id_column: InstrumentedAttribute[int],
    name_column: InstrumentedAttribute[str],
    ids: Iterable[int],
    *criteria: ColumnElement[bool],
) -> dict[int, str]:
    requested_ids = {int(item_id) for item_id in ids}
    if not requested_ids:
        return {}
    rows = db.execute(
        select(id_column, name_column).where(
            id_column.in_(requested_ids),
            *criteria,
        )
    ).all()
    return {int(item_id): str(name) for item_id, name in rows}


def load_s3_user_names(db: Session, ids: list[int]) -> dict[int, str]:
    return _load_names(db, S3User.id, S3User.name, ids)


def load_shared_s3_connection_names(
    db: Session,
    ids: list[int],
) -> dict[int, str]:
    return _load_names(
        db,
        S3Connection.id,
        S3Connection.name,
        ids,
        S3Connection.is_shared.is_(True),
    )
