# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.utils.time import utcnow

import uuid
import json
from datetime import timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import constant_time_equal, create_api_access_token, hash_refresh_token
from app.db import ApiToken, User, is_admin_ui_role

settings = get_settings()


class ApiTokenError(ValueError):
    pass


class ApiTokenNotFoundError(ApiTokenError):
    pass


class ApiTokenService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_for_user(
        self,
        user: User,
        *,
        name: str,
        scopes: list[str],
        expires_in_days: Optional[int] = None,
    ) -> tuple[str, ApiToken]:
        if not is_admin_ui_role(user.role):
            raise ApiTokenError("Only UI admins can create API tokens")
        if user.id is None:
            raise ApiTokenError("User id is required to create API tokens")
        token_name = (name or "").strip()
        if not token_name:
            raise ApiTokenError("Token name is required")
        days = expires_in_days or settings.api_token_default_expire_days
        if days < 1 or days > settings.api_token_max_expire_days:
            raise ApiTokenError(
                f"Token expiry must be between 1 and {settings.api_token_max_expire_days} days",
            )
        now = utcnow()
        expires_at = now + timedelta(days=days)
        jti = uuid.uuid4().hex
        token_id = str(uuid.uuid4())
        normalized_scopes = sorted(set(scopes))
        if not normalized_scopes:
            raise ApiTokenError("At least one API token scope is required")
        token = create_api_access_token(
            user_id=user.id,
            token_id=token_id,
            auth_version=user.auth_version,
            role=user.role,
            scopes=normalized_scopes,
            expires_delta=expires_at - now,
            jti=jti,
        )
        row = ApiToken(
            id=token_id,
            jti=jti,
            token_hash=hash_refresh_token(token),
            user_id=user.id,
            name=token_name,
            scopes_json=json.dumps(normalized_scopes, separators=(",", ":")),
            auth_version=user.auth_version,
            created_at=now,
            expires_at=expires_at,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return token, row

    def list_for_user(self, user_id: int, *, include_revoked: bool = False) -> list[ApiToken]:
        statement = select(ApiToken).where(ApiToken.user_id == user_id)
        if not include_revoked:
            statement = statement.where(
                ApiToken.revoked_at.is_(None),
                ApiToken.expires_at > utcnow(),
            )
        return self.db.scalars(statement.order_by(ApiToken.created_at.desc())).all()

    def revoke_for_user(self, *, user_id: int, token_id: str) -> ApiToken:
        row = self.db.scalar(
            select(ApiToken).where(
                ApiToken.id == token_id,
                ApiToken.user_id == user_id,
            )
        )
        if not row:
            raise ApiTokenNotFoundError("API token not found")
        if row.revoked_at is None:
            row.revoked_at = utcnow()
            self.db.commit()
            self.db.refresh(row)
        return row

    def resolve_user_from_claims(
        self,
        claims: dict,
        *,
        token: Optional[str] = None,
        required_scope: Optional[str] = None,
    ) -> Optional[User]:
        claim_identity = self._claim_identity(claims)
        if claim_identity is None:
            return None
        jti, user_id = claim_identity
        row = self.db.scalar(select(ApiToken).where(ApiToken.jti == jti))
        if not row:
            return None
        if not constant_time_equal(hash_refresh_token(token or ""), row.token_hash):
            return None
        now = utcnow()
        if not self._token_row_matches_claims(
            row,
            claims,
            user_id=user_id,
            required_scope=required_scope,
            now=now,
        ):
            return None
        user = self._active_token_user(row, user_id)
        if user is None:
            return None
        row.last_used_at = now
        self.db.commit()
        return user

    @staticmethod
    def _claim_identity(claims: dict) -> tuple[str, int] | None:
        if claims.get("typ") != "api_access":
            return None
        jti = claims.get("jti")
        if not isinstance(jti, str) or not jti:
            return None
        try:
            user_id = int(claims.get("uid"))
        except (TypeError, ValueError):
            return None
        return jti, user_id

    @staticmethod
    def _token_row_matches_claims(
        row: ApiToken,
        claims: dict,
        *,
        user_id: int,
        required_scope: Optional[str],
        now,
    ) -> bool:
        if row.revoked_at is not None or row.expires_at <= now:
            return False
        if row.user_id != user_id:
            return False
        if claims.get("sid") != row.id or claims.get("auth_version") != row.auth_version:
            return False
        try:
            db_scopes = sorted(json.loads(row.scopes_json))
        except (TypeError, ValueError, json.JSONDecodeError):
            return False
        claim_scopes = sorted(claims.get("scopes") or [])
        if db_scopes != claim_scopes:
            return False
        return required_scope is None or required_scope in db_scopes

    def _active_token_user(self, row: ApiToken, user_id: int) -> User | None:
        user = self.db.get(User, user_id)
        if (
            not user
            or not user.is_active
            or not is_admin_ui_role(user.role)
            or user.auth_version != row.auth_version
        ):
            return None
        return user
