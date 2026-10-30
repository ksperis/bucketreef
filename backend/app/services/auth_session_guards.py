# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import AuthSession
from app.services.auth_session_service import AuthSessionError, AuthSessionService
from app.services.webauthn_service import WebAuthnService
from app.utils.time import utcnow


_settings = get_settings()
_REQUEST_AUTH_SESSION_ATTR = "bucketreef_auth_session"


def cache_auth_session(request: Request, session: AuthSession) -> None:
    setattr(request.state, _REQUEST_AUTH_SESSION_ATTR, session)


def current_auth_session(request: Request, db: Session) -> AuthSession:
    cached = getattr(request.state, _REQUEST_AUTH_SESSION_ATTR, None)
    if isinstance(cached, AuthSession):
        return cached
    token = request.cookies.get(_settings.access_token_cookie_name)
    try:
        row, _, _ = AuthSessionService(db).validate_access_token(token or "")
    except AuthSessionError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="UI session required",
        ) from exc
    cache_auth_session(request, row)
    return row


def require_recent_mfa(request: Request, db: Session) -> AuthSession:
    row = current_auth_session(request, db)
    if not WebAuthnService(db).is_recent(row):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent WebAuthn verification required")
    return row


def require_recent_primary_auth(request: Request, db: Session) -> AuthSession:
    row = current_auth_session(request, db)
    if row.created_at < utcnow() - timedelta(minutes=_settings.mfa_recent_minutes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recent primary authentication required")
    return row
