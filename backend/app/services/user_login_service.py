# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.security import consume_dummy_password_hash, verify_and_update_password
from app.db import User
from app.services.auth_session_service import AuthSessionService
from app.services.user_query_service import UserQueryService
from app.utils.time import utcnow

logger = logging.getLogger(__name__)


class UserLoginService:
    """Authenticate local UI users and persist successful login activity."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.query = UserQueryService(db)

    def authenticate_password(self, email: str, password: str) -> User | None:
        user = self.query.get_by_email(email)
        if not user or not user.is_active or not user.hashed_password:
            consume_dummy_password_hash(password)
            return None

        valid, updated_hash = verify_and_update_password(password, user.hashed_password)
        if not valid:
            return None

        logger.debug("Authenticated user id=%s email=%s", user.id, user.email)
        return self._persist_successful_login(user, updated_hash=updated_hash)

    def mark_last_login(self, user: User) -> User:
        return self._persist_successful_login(user)

    def _persist_successful_login(
        self,
        user: User,
        *,
        updated_hash: str | None = None,
    ) -> User:
        user_id = int(user.id)
        logged_in_at = utcnow()

        def persist_once(write_db: Session) -> int:
            current = write_db.get(User, user_id, populate_existing=True)
            if current is None:
                raise RuntimeError("Authenticated user disappeared while persisting login activity")
            if updated_hash:
                current.hashed_password = updated_hash
                current.auth_version += 1
                AuthSessionService(write_db).revoke_all_for_user_in_transaction(
                    current,
                    "password_rehashed",
                    increment_version=False,
                )
            current.last_login_at = logged_in_at
            return user_id

        run_replayable_db_unit(self.db, persist_once)
        current = self.db.get(User, user_id, populate_existing=True)
        if current is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Authenticated user could not be reloaded after persisting login activity")
        return current
