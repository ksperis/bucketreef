# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.ceph_multisite import (
    BilogInfo, BucketDiagnostic, Capabilities, Flow, LogPage, Observation, Overview, Topology,
)
from app.routers.dependencies import get_current_ceph_admin
from app.services.ceph_multisite_service import CephMultisiteService

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/multisite", tags=["ceph-admin-multisite"])
Identifier = Annotated[str, Query(min_length=1, max_length=255, pattern=r"^[^\s\x00-\x1f/?:#]+$")]
BucketName = Annotated[str, Query(min_length=1, max_length=255, pattern=r"^[^\s\x00-\x1f/:]+$")]
Tenant = Annotated[str | None, Query(max_length=255, pattern=r"^[^\s\x00-\x1f/:]*$")]
Cursor = Annotated[str | None, Query(max_length=8192)]


def service(
    endpoint_id: int = Path(ge=1), db: Session = Depends(get_db),
    actor: User = Depends(get_current_ceph_admin),
) -> CephMultisiteService:
    return CephMultisiteService(db, endpoint_id, actor_id=actor.id)


Service = Annotated[CephMultisiteService, Depends(service)]


@router.get("/topology", response_model=Topology)
def topology(svc: Service):
    return svc.topology()


@router.get("/capabilities", response_model=Capabilities)
def capabilities(svc: Service):
    return svc.capabilities()


@router.get("/overview", response_model=Overview)
def overview(svc: Service, offset: int = Query(0, ge=0, le=10000)):
    return svc.overview(offset)


@router.get("/flows/status", response_model=Flow)
def flow(svc: Service, destination_endpoint_id: int = Query(ge=1), *, source_zone_id: Identifier,
         family: Literal["metadata", "data"] = "data"):
    destination = svc.resolve(destination_endpoint_id)
    return svc.flow(svc.topology(), destination, source_zone_id, family)


@router.get("/bucket/status", response_model=BucketDiagnostic)
def bucket_status(svc: Service, *, source_endpoint_id: int = Query(ge=1), destination_endpoint_id: int = Query(ge=1),
                  source_zone_id: Identifier, bucket: BucketName, source_bucket: BucketName,
                  tenant: Tenant = None, source_tenant: Tenant = None):
    return svc.bucket(source_endpoint_id=source_endpoint_id, destination_endpoint_id=destination_endpoint_id,
                      source_zone_id=source_zone_id, bucket=bucket, source_bucket=source_bucket,
                      tenant=tenant or None, source_tenant=source_tenant or None)


@router.get("/bucket/bilog-info", response_model=Observation[BilogInfo])
def bilog_info(svc: Service, *, target_endpoint_id: int = Query(ge=1), bucket: BucketName, tenant: Tenant = None):
    return svc.bilog_info(target_endpoint_id, bucket, tenant or None)


@router.get("/logs/metadata", response_model=Observation[LogPage])
def metadata_log(svc: Service, *, target_endpoint_id: int = Query(ge=1), period: Identifier,
                 shard: int = Query(ge=0, le=2147483647), cursor: Cursor = None, limit: int = Query(100, ge=1, le=500)):
    return svc.logs("metadata", target_endpoint_id=target_endpoint_id, period=period, shard=shard, cursor=cursor, limit=limit)


@router.get("/logs/data", response_model=Observation[LogPage])
def data_log(svc: Service, *, target_endpoint_id: int = Query(ge=1), shard: int = Query(ge=0, le=2147483647),
             cursor: Cursor = None, limit: int = Query(100, ge=1, le=500)):
    return svc.logs("data", target_endpoint_id=target_endpoint_id, shard=shard, cursor=cursor, limit=limit)


@router.get("/logs/bucket-index", response_model=Observation[LogPage])
def bucket_log(svc: Service, *, target_endpoint_id: int = Query(ge=1), bucket: BucketName,
               generation: Annotated[str, Query(pattern=r"^(0|[1-9][0-9]{0,19})$")],
               tenant: Tenant = None, instance_id: Identifier | None = None,
               shard: int | None = Query(None, ge=0, le=2147483647),
               cursor: Cursor = None, limit: int = Query(100, ge=1, le=500)):
    if int(generation) > 2**64 - 1:
        raise HTTPException(422, "Generation must fit a uint64 integer")
    return svc.logs("bucket-index", target_endpoint_id=target_endpoint_id, bucket=bucket, tenant=tenant or None,
                    instance_id=instance_id, generation=generation, shard=shard, cursor=cursor, limit=limit)


@router.get("/logs/shard-info", response_model=Observation[dict])
def shard_info(svc: Service, *, target_endpoint_id: int = Query(ge=1), family: Literal["metadata", "data"],
                shard: int = Query(ge=0, le=2147483647), period: Identifier | None = None):
    return svc.shard_info(target_endpoint_id=target_endpoint_id, family=family, shard=shard, period=period)
