# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.openstack import OpenStackCloud
from app.models.admin_listing import AdminPaginatedListingRequest
from app.models.openstack import (
    OpenStackCloudRead,
    OpenStackCloudWrite,
    PaginatedOpenStackCloudsResponse,
)
from app.services.sqlalchemy_pagination import paginate_scalars


class OpenStackCloudQueryService:
    """Read and serialize OpenStack cloud configuration for Admin surfaces."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def serialize_cloud(cloud: OpenStackCloud) -> OpenStackCloudRead:
        return OpenStackCloudRead(
            id=cloud.id,
            **{
                field_name: getattr(cloud, field_name)
                for field_name in OpenStackCloudWrite.model_fields
            },
        )

    def list_clouds(self) -> list[OpenStackCloudRead]:
        rows = self.db.scalars(
            select(OpenStackCloud).order_by(OpenStackCloud.name, OpenStackCloud.id)
        ).all()
        return [self.serialize_cloud(row) for row in rows]

    def list_clouds_page(
        self,
        request: AdminPaginatedListingRequest,
    ) -> PaginatedOpenStackCloudsResponse:
        query = select(OpenStackCloud)
        normalized_search = (request.search or "").strip()
        if normalized_search:
            query = query.where(OpenStackCloud.name.ilike(f"%{normalized_search}%"))
        rows, total, has_next = paginate_scalars(
            self.db,
            query,
            order_by=(OpenStackCloud.name, OpenStackCloud.id),
            page=request.page,
            page_size=request.page_size,
        )
        return PaginatedOpenStackCloudsResponse(
            items=[self.serialize_cloud(row) for row in rows],
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=has_next,
        )
