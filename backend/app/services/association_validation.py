# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy.orm import Session


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
