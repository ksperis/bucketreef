# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from uuid import uuid4

from sqlalchemy import delete, func, select, update

from app.core.domain_errors import BrowserFavoriteConflictError, BrowserFavoriteNotFoundError
from app.core.db_transactions import commit_or_rollback
from app.db.browser_favorite import BrowserFavorite
from app.models.browser_favorites import BrowserFavoriteInput, BrowserFavoriteOut
from app.utils.time import utcnow


class BrowserFavoritesService:
    def __init__(self, db):
        self.db = db

    @staticmethod
    def output(row):
        return BrowserFavoriteOut.model_validate(row, from_attributes=True)

    def list(self, user):
        rows = self.db.scalars(
            select(BrowserFavorite)
            .where(BrowserFavorite.user_id == user.id)
            .order_by(BrowserFavorite.created_at, BrowserFavorite.id)
        ).all()
        return [self.output(row) for row in rows]

    def create(self, user, payload: BrowserFavoriteInput):
        favorite_count = self.db.scalar(
            select(func.count()).select_from(BrowserFavorite).where(
                BrowserFavorite.user_id == user.id
            )
        )
        if favorite_count >= 500:
            raise BrowserFavoriteConflictError("The 500 favorites limit has been reached")
        row = BrowserFavorite(
            id=str(uuid4()),
            user_id=user.id,
            **payload.model_dump(),
            revision=1,
        )
        self.db.add(row)
        commit_or_rollback(self.db)
        self.db.refresh(row)
        return self.output(row)

    def mutate(self, user, favorite_id, revision, payload: BrowserFavoriteInput | None = None):
        owned = self.db.scalar(
            select(BrowserFavorite).where(
                BrowserFavorite.id == favorite_id,
                BrowserFavorite.user_id == user.id,
            )
        )
        if owned is None:
            raise BrowserFavoriteNotFoundError("Favorite not found")
        predicate = (
            BrowserFavorite.id == favorite_id,
            BrowserFavorite.user_id == user.id,
            BrowserFavorite.revision == revision,
        )
        statement = (
            delete(BrowserFavorite).where(*predicate)
            if payload is None
            else update(BrowserFavorite)
            .where(*predicate)
            .values(
                **payload.model_dump(),
                revision=revision + 1,
                updated_at=utcnow(),
            )
        )
        result = self.db.execute(statement.execution_options(synchronize_session=False))
        if result.rowcount != 1:
            self.db.rollback()
            raise BrowserFavoriteConflictError(
                "This favorite changed in another browser. Refresh before editing it."
            )
        commit_or_rollback(self.db)
        if payload is None:
            return None
        self.db.refresh(owned)
        return self.output(owned)
