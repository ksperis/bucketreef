# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
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
        if updated_hash:
            user.hashed_password = updated_hash
            user.auth_version += 1
            self.db.add(user)
            AuthSessionService(self.db).revoke_all_for_user_in_transaction(
                user,
                "password_rehashed",
                increment_version=False,
            )

        logger.debug("Authenticated user id=%s email=%s", user.id, user.email)
        return self.mark_last_login(user)

    def mark_last_login(self, user: User) -> User:
        user.last_login_at = utcnow()
        self.db.add(user)
        commit_or_rollback(self.db)
        self.db.refresh(user)
        return user
