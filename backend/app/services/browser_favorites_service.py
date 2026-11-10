# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.domain_errors import BrowserFavoriteConflictError, BrowserFavoriteNotFoundError
from app.core.db_transactions import run_replayable_db_unit
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
        user_id = user.id
        favorite_id = str(uuid4())
        favorite_values = payload.model_dump()

        def create_once(write_db: Session) -> BrowserFavoriteOut:
            favorite_count = write_db.scalar(
                select(func.count()).select_from(BrowserFavorite).where(
                    BrowserFavorite.user_id == user_id
                )
            )
            if favorite_count >= 500:
                raise BrowserFavoriteConflictError("The 500 favorites limit has been reached")
            row = BrowserFavorite(
                id=favorite_id,
                user_id=user_id,
                **favorite_values,
                revision=1,
            )
            write_db.add(row)
            write_db.flush()
            return self.output(row)

        return run_replayable_db_unit(self.db, create_once)

    def mutate(self, user, favorite_id, revision, payload: BrowserFavoriteInput | None = None):
        user_id = user.id
        payload_values = payload.model_dump() if payload is not None else None
        updated_at = utcnow()

        def mutate_once(write_db: Session) -> None:
            owned = write_db.scalar(
                select(BrowserFavorite).where(
                    BrowserFavorite.id == favorite_id,
                    BrowserFavorite.user_id == user_id,
                )
            )
            if owned is None:
                raise BrowserFavoriteNotFoundError("Favorite not found")
            predicate = (
                BrowserFavorite.id == favorite_id,
                BrowserFavorite.user_id == user_id,
                BrowserFavorite.revision == revision,
            )
            statement = (
                delete(BrowserFavorite).where(*predicate)
                if payload_values is None
                else update(BrowserFavorite)
                .where(*predicate)
                .values(
                    **payload_values,
                    revision=revision + 1,
                    updated_at=updated_at,
                )
            )
            result = write_db.execute(statement.execution_options(synchronize_session=False))
            if result.rowcount != 1:
                raise BrowserFavoriteConflictError(
                    "This favorite changed in another browser. Refresh before editing it."
                )

        run_replayable_db_unit(self.db, mutate_once)
        if payload is None:
            return None
        row = self.db.get(BrowserFavorite, favorite_id)
        if row is None:
            raise BrowserFavoriteNotFoundError("Favorite not found")
        return self.output(row)
