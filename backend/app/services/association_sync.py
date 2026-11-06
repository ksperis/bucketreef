# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from datetime import datetime
from typing import Protocol, TypeVar

from sqlalchemy import Column, Table, delete, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue
from app.utils.time import utcnow


LinkT = TypeVar("LinkT")
MetadataT = TypeVar("MetadataT")


class AccountAccessLink(Protocol):
    manager_role: ManagerAccountRoleValue | None
    portal_role: PortalAccountRoleValue | None
    allow_manager_browser_data_access: bool
    updated_at: datetime


class AccountAccessGrantLike(Protocol):
    manager_role: ManagerAccountRoleValue | None
    portal_role: PortalAccountRoleValue | None
    allow_manager_browser_data_access: bool


def update_account_access_link(
    row: AccountAccessLink,
    grant: AccountAccessGrantLike,
) -> None:
    """Apply the mutable metadata shared by direct and group account links."""

    row.manager_role = grant.manager_role
    row.portal_role = grant.portal_role
    row.allow_manager_browser_data_access = grant.allow_manager_browser_data_access
    row.updated_at = utcnow()


def sync_simple_association_links(
    db: Session,
    *,
    link_model: type[LinkT],
    owner_column: InstrumentedAttribute[int],
    owner_id: int,
    target_column: InstrumentedAttribute[int],
    desired_ids: Iterable[int],
    link_factory: Callable[[int], LinkT],
) -> set[int]:
    """Synchronize a plain many-to-many link table and return changed target IDs."""

    desired_id_set = {int(target_id) for target_id in desired_ids}
    existing_ids = {
        int(target_id)
        for target_id in db.scalars(
            select(target_column).where(owner_column == owner_id)
        ).all()
    }
    removed_ids = existing_ids - desired_id_set
    added_ids = desired_id_set - existing_ids
    if removed_ids:
        db.execute(
            delete(link_model)
            .where(
                owner_column == owner_id,
                target_column.in_(removed_ids),
            )
            .execution_options(synchronize_session=False)
        )
    for target_id in sorted(added_ids):
        db.add(link_factory(target_id))
    return removed_ids | added_ids


def sync_table_association_links(
    db: Session,
    *,
    table: Table,
    owner_column: Column[int],
    owner_id: int,
    target_column: Column[int],
    desired_ids: Iterable[int],
) -> set[int]:
    """Synchronize a SQLAlchemy Core association table and return changed IDs."""

    desired_id_set = {int(target_id) for target_id in desired_ids}
    existing_ids = {
        int(target_id)
        for target_id in db.scalars(
            select(target_column).where(owner_column == owner_id)
        ).all()
    }
    removed_ids = existing_ids - desired_id_set
    added_ids = desired_id_set - existing_ids
    if removed_ids:
        db.execute(
            delete(table).where(
                owner_column == owner_id,
                target_column.in_(removed_ids),
            )
        )
    for target_id in sorted(added_ids):
        db.execute(
            table.insert().values(
                {
                    owner_column.key: owner_id,
                    target_column.key: target_id,
                }
            )
        )
    return removed_ids | added_ids


def sync_metadata_association_links(
    db: Session,
    *,
    link_model: type[LinkT],
    owner_column: InstrumentedAttribute[int],
    owner_id: int,
    target_column: InstrumentedAttribute[int],
    desired_by_id: Mapping[int, MetadataT],
    link_factory: Callable[[int, MetadataT], LinkT],
    update_link: Callable[[LinkT, MetadataT], None],
    before_create: Callable[[set[int]], None] | None = None,
    on_create: Callable[[int, MetadataT], None] | None = None,
) -> None:
    """Synchronize a many-to-many link table whose rows carry mutable metadata."""

    desired = {int(target_id): metadata for target_id, metadata in desired_by_id.items()}
    existing = db.scalars(
        select(link_model).where(owner_column == owner_id)
    ).all()
    existing_by_id = {
        int(getattr(link, target_column.key)): link
        for link in existing
    }
    new_ids = set(desired) - set(existing_by_id)
    if new_ids and before_create is not None:
        before_create(new_ids)

    for target_id in set(existing_by_id) - set(desired):
        db.delete(existing_by_id[target_id])

    for target_id, metadata in desired.items():
        row = existing_by_id.get(target_id)
        if row is None:
            if on_create is not None:
                on_create(target_id, metadata)
            row = link_factory(target_id, metadata)
        update_link(row, metadata)
        db.add(row)
