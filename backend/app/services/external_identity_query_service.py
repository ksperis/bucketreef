# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import ExternalIdentity, ExternalIdentityLinkRequest, User
from app.utils.time import utcnow


class ExternalIdentityQueryService:
    """Read external identity state without owning authentication mutations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_link_requests(
        self,
        *,
        include_decided: bool = False,
    ) -> list[ExternalIdentityLinkRequest]:
        statement = select(ExternalIdentityLinkRequest)
        if not include_decided:
            statement = statement.where(
                ExternalIdentityLinkRequest.status == "pending",
                ExternalIdentityLinkRequest.expires_at > utcnow(),
            )
        return self.db.scalars(
            statement.order_by(ExternalIdentityLinkRequest.created_at.desc())
        ).all()

    def list_for_user(
        self,
        user_id: int,
        *,
        include_revoked: bool = False,
    ) -> list[ExternalIdentity]:
        statement = select(ExternalIdentity).where(
            ExternalIdentity.user_id == user_id
        )
        if not include_revoked:
            statement = statement.where(ExternalIdentity.revoked_at.is_(None))
        return self.db.scalars(
            statement.order_by(ExternalIdentity.created_at.asc())
        ).all()

    def find_mapping(
        self,
        provider_type: str,
        provider_id: str,
        subject: str,
        *,
        issuer: Optional[str] = None,
        include_revoked: bool = False,
    ) -> ExternalIdentity | None:
        statement = select(ExternalIdentity).where(
            ExternalIdentity.provider_type == provider_type,
            ExternalIdentity.subject == subject,
        )
        if provider_type == "oidc":
            statement = statement.where(ExternalIdentity.issuer == issuer)
        else:
            statement = statement.where(ExternalIdentity.provider_id == provider_id)
        if not include_revoked:
            statement = statement.where(ExternalIdentity.revoked_at.is_(None))
        return self.db.scalar(statement)

    def find_email_candidates(self, email: str) -> list[User]:
        return self.db.scalars(
            select(User).where(func.lower(User.email) == email)
        ).all()

    def has_alternate_primary_login(
        self,
        user: User,
        *,
        excluding_identity_id: str,
    ) -> bool:
        if bool(user.hashed_password):
            return True
        return self.db.scalar(
            select(ExternalIdentity.id)
            .where(
                ExternalIdentity.user_id == user.id,
                ExternalIdentity.id != excluding_identity_id,
                ExternalIdentity.revoked_at.is_(None),
            )
            .limit(1)
        ) is not None
