# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.db import AuthChallenge, RecoveryCode, User, WebAuthnCredential
from app.services.auth_session_service import AuthSessionService


@dataclass(frozen=True)
class MfaResetResult:
    passkeys_removed: int
    recovery_codes_removed: int
    challenges_removed: int


class MfaResetService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def reset(self, user: User, *, reason: str) -> MfaResetResult:
        if user.id is None:
            raise ValueError("User id is required to reset MFA")
        user_id = int(user.id)

        def persist(write_db: Session) -> MfaResetResult:
            target = write_db.get(User, user_id)
            if target is None:
                raise ValueError("User does not exist")
            passkeys_removed = write_db.execute(
                delete(WebAuthnCredential)
                .where(WebAuthnCredential.user_id == user_id)
                .execution_options(synchronize_session=False)
            ).rowcount
            recovery_codes_removed = write_db.execute(
                delete(RecoveryCode)
                .where(RecoveryCode.user_id == user_id)
                .execution_options(synchronize_session=False)
            ).rowcount
            challenges_removed = write_db.execute(
                delete(AuthChallenge)
                .where(AuthChallenge.user_id == user_id)
                .execution_options(synchronize_session=False)
            ).rowcount
            target.auth_version += 1
            AuthSessionService(write_db).revoke_all_for_user_in_transaction(
                target,
                reason,
                increment_version=False,
            )
            return MfaResetResult(
                passkeys_removed=int(passkeys_removed or 0),
                recovery_codes_removed=int(recovery_codes_removed or 0),
                challenges_removed=int(challenges_removed or 0),
            )

        result = run_replayable_db_unit(self.db, persist)
        self.db.get(User, user_id, populate_existing=True)
        return result
