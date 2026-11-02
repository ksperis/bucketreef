# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.db import AuthSession
from app.models.auth import SessionInfo


def auth_session_info(
    row: AuthSession,
    *,
    current_id: Optional[str] = None,
) -> SessionInfo:
    return SessionInfo(
        id=row.id,
        principal_type=row.principal_type,
        auth_type=row.auth_type,
        created_at=row.created_at,
        last_activity_at=row.last_activity_at,
        idle_expires_at=row.idle_expires_at,
        absolute_expires_at=row.absolute_expires_at,
        mfa_verified_at=row.mfa_verified_at,
        ip_address=row.ip_address,
        user_agent=row.user_agent,
        revoked_at=row.revoked_at,
        revoke_reason=row.revoke_reason,
        current=row.id == current_id,
        user_id=row.user_id,
        s3_session_id=row.s3_session_id,
    )
