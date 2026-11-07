# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3AccountNotFoundError
from app.db import S3Account, S3AccountDeletion


class S3AccountRepository:
    """Persistence queries and uniqueness checks for S3 accounts."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, account_id: int) -> S3Account:
        account = self.db.get(S3Account, account_id)
        if account is None:
            raise S3AccountNotFoundError("S3Account not found")
        return account

    def ensure_not_pending_deletion(self, account_id: int) -> None:
        pending = self.db.scalar(
            select(S3AccountDeletion.id).where(
                S3AccountDeletion.account_id == account_id
            )
        )
        if pending is not None:
            raise ValueError(
                "S3 account deletion is pending; retry deletion before modifying this account"
            )

    def find_by_rgw_id(self, rgw_account_id: str) -> Optional[S3Account]:
        return self.db.scalar(
            select(S3Account).where(S3Account.rgw_account_id == rgw_account_id)
        )

    def existing_rgw_ids(self, rgw_account_ids: set[str]) -> set[str]:
        if not rgw_account_ids:
            return set()
        return {
            str(rgw_account_id)
            for rgw_account_id in self.db.scalars(
                select(S3Account.rgw_account_id).where(
                    S3Account.rgw_account_id.in_(rgw_account_ids)
                )
            ).all()
        }

    def ensure_name_available(
        self,
        *,
        storage_endpoint_id: int,
        rgw_tenant: str,
        name: str,
        exclude_account_id: Optional[int] = None,
        error_message: str = "S3Account already exists",
    ) -> None:
        query = select(S3Account.id).where(
            S3Account.storage_endpoint_id == storage_endpoint_id,
            S3Account.rgw_tenant == rgw_tenant,
            S3Account.name == name,
        )
        if exclude_account_id is not None:
            query = query.where(S3Account.id != exclude_account_id)
        if self.db.scalar(query.limit(1)) is not None:
            raise ValueError(error_message)
