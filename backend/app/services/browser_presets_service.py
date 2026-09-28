# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from app.db.browser_preset import BrowserPreset
from app.models.browser_presets import BrowserPresetInput, BrowserPresetOut
from app.utils.time import utcnow


class BrowserPresetsService:
    def __init__(self, db):
        self.db = db

    @staticmethod
    def output(row):
        return BrowserPresetOut(**json.loads(row.payload_json), id=row.id, revision=row.revision, created_at=row.created_at, updated_at=row.updated_at)

    def list(self, user, surface):
        rows = self.db.scalars(select(BrowserPreset).where(BrowserPreset.user_id == user.id, BrowserPreset.surface == surface).order_by(BrowserPreset.created_at, BrowserPreset.id)).all()
        return [self.output(row) for row in rows]

    def create(self, user, payload: BrowserPresetInput):
        if self.db.query(BrowserPreset).filter_by(user_id=user.id).count() >= 500:
            raise HTTPException(status_code=409, detail="The 500 saved locations/views limit has been reached")
        row = BrowserPreset(id=str(uuid4()), user_id=user.id, surface=payload.surface, payload_json=payload.model_dump_json(), revision=1)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return self.output(row)

    def mutate(self, user, preset_id, revision, payload: BrowserPresetInput | None = None):
        owned = self.db.scalar(select(BrowserPreset).where(BrowserPreset.id == preset_id, BrowserPreset.user_id == user.id))
        if owned is None:
            raise HTTPException(status_code=404, detail="Saved view not found")
        predicate = (BrowserPreset.id == preset_id, BrowserPreset.user_id == user.id, BrowserPreset.revision == revision)
        statement = delete(BrowserPreset).where(*predicate) if payload is None else update(BrowserPreset).where(*predicate).values(surface=payload.surface, payload_json=payload.model_dump_json(), revision=revision + 1, updated_at=utcnow())
        result = self.db.execute(statement.execution_options(synchronize_session=False))
        if result.rowcount != 1:
            self.db.rollback()
            raise HTTPException(status_code=409, detail="This saved view changed in another browser. Refresh before editing it.")
        self.db.commit()
        if payload is None:
            return None
        self.db.refresh(owned)
        return self.output(owned)
