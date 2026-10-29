# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import StorageEndpoint


def _multisite_key(endpoint: StorageEndpoint) -> tuple[str, str] | None:
    if endpoint.provider != "ceph":
        return None
    realm_id = (endpoint.realm_id or "").strip()
    zonegroup_id = (endpoint.zonegroup_id or "").strip()
    if not realm_id or not zonegroup_id:
        return None
    return realm_id, zonegroup_id


def rgw_multisite_endpoints_compatible(
    origin: StorageEndpoint,
    destination: StorageEndpoint,
) -> bool:
    key = _multisite_key(origin)
    return key is not None and key == _multisite_key(destination)


def list_compatible_rgw_execution_endpoints(
    db: Session,
    origin: StorageEndpoint,
) -> list[StorageEndpoint]:
    key = _multisite_key(origin)
    if key is None:
        return [origin]
    realm_id, zonegroup_id = key
    return list(
        db.scalars(
            select(StorageEndpoint)
            .where(
                StorageEndpoint.provider == "ceph",
                StorageEndpoint.realm_id == realm_id,
                StorageEndpoint.zonegroup_id == zonegroup_id,
            )
            .order_by(StorageEndpoint.name.asc(), StorageEndpoint.id.asc())
        ).all()
    )
