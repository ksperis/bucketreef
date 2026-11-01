# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import TypeVar

from sqlalchemy import delete, select
from sqlalchemy.orm import InstrumentedAttribute, Session


LinkT = TypeVar("LinkT")


def sync_simple_association_links(
    db: Session,
    *,
    link_model: type[LinkT],
    owner_column: InstrumentedAttribute[int],
    owner_id: int,
    target_column: InstrumentedAttribute[int],
    desired_ids: Iterable[int],
    link_factory: Callable[[int], LinkT],
) -> None:
    """Synchronize a plain many-to-many link table without per-link metadata."""

    desired_id_set = {int(target_id) for target_id in desired_ids}
    existing_ids = {
        int(target_id)
        for target_id in db.scalars(
            select(target_column).where(owner_column == owner_id)
        ).all()
    }
    removed_ids = existing_ids - desired_id_set
    if removed_ids:
        db.execute(
            delete(link_model)
            .where(
                owner_column == owner_id,
                target_column.in_(removed_ids),
            )
            .execution_options(synchronize_session=False)
        )
    for target_id in sorted(desired_id_set - existing_ids):
        db.add(link_factory(target_id))
