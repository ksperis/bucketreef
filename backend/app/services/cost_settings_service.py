# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import CostEndpointOverride, CostModel, StorageEndpoint
from app.models.cost import CostEndpointOverride as CostEndpointOverrideModel
from app.models.cost import CostGlobalModel, CostSettings
from app.utils.time import utcnow


class CostSettingsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_settings(self) -> CostSettings:
        model = self.db.get(CostModel, 1)
        overrides = self.db.scalars(
            select(CostEndpointOverride).order_by(CostEndpointOverride.storage_endpoint_id.asc())
        ).all()
        return CostSettings(
            model=(
                CostGlobalModel(
                    currency=model.currency,
                    storage_gb_month_price=model.storage_gb_month_price,
                    egress_gb_price=model.egress_gb_price,
                    ingress_gb_price=model.ingress_gb_price,
                    requests_per_1000_price=model.requests_per_1000_price,
                )
                if model is not None
                else None
            ),
            endpoint_overrides=[
                CostEndpointOverrideModel(
                    storage_endpoint_id=row.storage_endpoint_id,
                    storage_gb_month_price=row.storage_gb_month_price,
                    egress_gb_price=row.egress_gb_price,
                    ingress_gb_price=row.ingress_gb_price,
                    requests_per_1000_price=row.requests_per_1000_price,
                )
                for row in overrides
            ],
        )

    def save_settings(self, payload: CostSettings) -> CostSettings:
        requested_endpoint_ids = {item.storage_endpoint_id for item in payload.endpoint_overrides}
        if requested_endpoint_ids:
            existing_endpoint_ids = set(
                self.db.scalars(
                    select(StorageEndpoint.id).where(StorageEndpoint.id.in_(requested_endpoint_ids))
                ).all()
            )
            missing = requested_endpoint_ids - existing_endpoint_ids
            if missing:
                raise ValueError(f"Unknown storage endpoint id: {min(missing)}")

        if payload.model is None:
            self.db.execute(delete(CostEndpointOverride))
            model = self.db.get(CostModel, 1)
            if model is not None:
                self.db.delete(model)
            self.db.commit()
            return self.get_settings()

        now = utcnow()
        model = self.db.get(CostModel, 1)
        if model is None:
            model = CostModel(id=1, created_at=now, updated_at=now)
            self.db.add(model)
        model.currency = payload.model.currency
        model.storage_gb_month_price = payload.model.storage_gb_month_price
        model.egress_gb_price = payload.model.egress_gb_price
        model.ingress_gb_price = payload.model.ingress_gb_price
        model.requests_per_1000_price = payload.model.requests_per_1000_price
        model.updated_at = now

        existing_overrides = {
            row.storage_endpoint_id: row
            for row in self.db.scalars(select(CostEndpointOverride)).all()
        }
        requested = {item.storage_endpoint_id: item for item in payload.endpoint_overrides}
        for endpoint_id, row in existing_overrides.items():
            if endpoint_id not in requested:
                self.db.delete(row)
        for endpoint_id, item in requested.items():
            row = existing_overrides.get(endpoint_id)
            if row is None:
                row = CostEndpointOverride(
                    storage_endpoint_id=endpoint_id,
                    created_at=now,
                    updated_at=now,
                )
                self.db.add(row)
            row.storage_gb_month_price = item.storage_gb_month_price
            row.egress_gb_price = item.egress_gb_price
            row.ingress_gb_price = item.ingress_gb_price
            row.requests_per_1000_price = item.requests_per_1000_price
            row.updated_at = now

        self.db.commit()
        return self.get_settings()
