# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.db import COST_MODEL_SINGLETON_ID, CostEndpointOverride, CostModel, StorageEndpoint
from app.models.cost import CostEndpointOverride as CostEndpointOverrideModel
from app.models.cost import CostGlobalModel, CostSettings
from app.utils.time import utcnow


def _apply_cost_payload(
    target: CostModel | CostEndpointOverride,
    payload: CostGlobalModel | CostEndpointOverrideModel,
) -> None:
    for field, value in payload.model_dump(exclude={"storage_endpoint_id"}).items():
        setattr(target, field, value)


class CostSettingsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_settings(self) -> CostSettings:
        model = self.db.get(CostModel, COST_MODEL_SINGLETON_ID)
        overrides = self.db.scalars(
            select(CostEndpointOverride).order_by(CostEndpointOverride.storage_endpoint_id.asc())
        ).all()
        return CostSettings(
            model=(
                CostGlobalModel.model_validate(model, from_attributes=True)
                if model is not None
                else None
            ),
            endpoint_overrides=[
                CostEndpointOverrideModel.model_validate(row, from_attributes=True)
                for row in overrides
            ],
        )

    def save_settings(self, payload: CostSettings) -> CostSettings:
        requested = {item.storage_endpoint_id: item for item in payload.endpoint_overrides}
        requested_endpoint_ids = set(requested)
        now = utcnow()

        def persist(write_db: Session) -> None:
            if requested_endpoint_ids:
                existing_endpoint_ids = set(
                    write_db.scalars(
                        select(StorageEndpoint.id).where(
                            StorageEndpoint.id.in_(requested_endpoint_ids)
                        )
                    ).all()
                )
                missing = requested_endpoint_ids - existing_endpoint_ids
                if missing:
                    raise ValueError(f"Unknown storage endpoint id: {min(missing)}")

            if payload.model is None:
                write_db.execute(delete(CostEndpointOverride))
                model = write_db.get(CostModel, COST_MODEL_SINGLETON_ID)
                if model is not None:
                    write_db.delete(model)
                return

            model = write_db.get(CostModel, COST_MODEL_SINGLETON_ID)
            if model is None:
                model = CostModel(id=COST_MODEL_SINGLETON_ID, created_at=now, updated_at=now)
                write_db.add(model)
            _apply_cost_payload(model, payload.model)
            model.updated_at = now

            existing_overrides = {
                row.storage_endpoint_id: row
                for row in write_db.scalars(select(CostEndpointOverride)).all()
            }
            for endpoint_id, row in existing_overrides.items():
                if endpoint_id not in requested:
                    write_db.delete(row)
            for endpoint_id, item in requested.items():
                row = existing_overrides.get(endpoint_id)
                if row is None:
                    row = CostEndpointOverride(
                        storage_endpoint_id=endpoint_id,
                        created_at=now,
                        updated_at=now,
                    )
                    write_db.add(row)
                _apply_cost_payload(row, item)
                row.updated_at = now

        run_replayable_db_unit(self.db, persist)
        return self.get_settings()
