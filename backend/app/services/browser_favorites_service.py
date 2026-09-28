# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import delete, select, update
from app.db.browser_favorite import BrowserFavorite
from app.models.browser_favorites import BrowserFavoriteInput, BrowserFavoriteOut
from app.utils.time import utcnow


class BrowserFavoritesService:
    def __init__(self, db):
        self.db = db

    @staticmethod
    def output(row):
        return BrowserFavoriteOut.model_validate(row, from_attributes=True)

    def list(self, user, surface):
        rows = self.db.scalars(select(BrowserFavorite).where(BrowserFavorite.user_id == user.id, BrowserFavorite.surface == surface).order_by(BrowserFavorite.created_at, BrowserFavorite.id)).all()
        return [self.output(row) for row in rows]

    def create(self, user, payload: BrowserFavoriteInput):
        if self.db.query(BrowserFavorite).filter_by(user_id=user.id).count() >= 500:
            raise HTTPException(status_code=409, detail="The 500 favorites limit has been reached")
        row = BrowserFavorite(id=str(uuid4()), user_id=user.id, **payload.model_dump(), revision=1)
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return self.output(row)

    def mutate(self, user, favorite_id, revision, payload: BrowserFavoriteInput | None = None):
        owned = self.db.scalar(select(BrowserFavorite).where(BrowserFavorite.id == favorite_id, BrowserFavorite.user_id == user.id))
        if owned is None:
            raise HTTPException(status_code=404, detail="Favorite not found")
        predicate = (BrowserFavorite.id == favorite_id, BrowserFavorite.user_id == user.id, BrowserFavorite.revision == revision)
        statement = delete(BrowserFavorite).where(*predicate) if payload is None else update(BrowserFavorite).where(*predicate).values(**payload.model_dump(), revision=revision + 1, updated_at=utcnow())
        result = self.db.execute(statement.execution_options(synchronize_session=False))
        if result.rowcount != 1:
            self.db.rollback()
            raise HTTPException(status_code=409, detail="This favorite changed in another browser. Refresh before editing it.")
        self.db.commit()
        if payload is None:
            return None
        self.db.refresh(owned)
        return self.output(owned)
