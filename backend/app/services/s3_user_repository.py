# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3UserNotFoundError
from app.db import S3User, S3UserDeletion


class S3UserRepository:
    """Persistence queries for managed S3 users."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, user_id: int) -> S3User:
        s3_user = self.db.scalar(select(S3User).where(S3User.id == user_id))
        if s3_user is None:
            raise S3UserNotFoundError("S3 user not found")
        return s3_user

    def ensure_not_pending_deletion(self, user_id: int) -> None:
        pending = self.db.scalar(
            select(S3UserDeletion.id).where(S3UserDeletion.s3_user_id == user_id)
        )
        if pending is not None:
            raise ValueError(
                "S3 user deletion is pending; retry deletion before modifying this user"
            )

    def find_identity(
        self,
        *,
        uid: str,
        tenant: str,
        storage_endpoint_id: int,
    ) -> Optional[S3User]:
        return self.db.scalar(
            select(S3User).where(
                S3User.storage_endpoint_id == storage_endpoint_id,
                S3User.rgw_user_uid == uid,
                S3User.rgw_tenant == tenant,
            )
        )
