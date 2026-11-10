# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from uuid import uuid4

from sqlalchemy import delete, func, select, update

from app.core.domain_errors import BrowserFavoriteConflictError, BrowserFavoriteNotFoundError
from app.core.db_transactions import commit_or_rollback, run_db_unit_with_sqlite_retry
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

        def create_once() -> BrowserFavoriteOut:
            favorite_count = self.db.scalar(
                select(func.count()).select_from(BrowserFavorite).where(
                    BrowserFavorite.user_id == user_id
                )
            )
            if favorite_count >= 500:
                raise BrowserFavoriteConflictError("The 500 favorites limit has been reached")
            row = BrowserFavorite(
                id=favorite_id,
                user_id=user_id,
                **payload.model_dump(),
                revision=1,
            )
            self.db.add(row)
            self.db.flush()
            output = self.output(row)
            commit_or_rollback(self.db)
            return output

        return run_db_unit_with_sqlite_retry(self.db, create_once)

    def mutate(self, user, favorite_id, revision, payload: BrowserFavoriteInput | None = None):
        user_id = user.id

        def mutate_once() -> None:
            owned = self.db.scalar(
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

        run_db_unit_with_sqlite_retry(self.db, mutate_once)
        if payload is None:
            return None
        row = self.db.get(BrowserFavorite, favorite_id)
        if row is None:
            raise BrowserFavoriteNotFoundError("Favorite not found")
        return self.output(row)
