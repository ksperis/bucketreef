# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3UserNotFoundError
from app.db import S3User


class S3UserRepository:
    """Persistence queries for managed S3 users."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, user_id: int) -> S3User:
        s3_user = self.db.scalar(select(S3User).where(S3User.id == user_id))
        if s3_user is None:
            raise S3UserNotFoundError("S3 user not found")
        return s3_user

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
