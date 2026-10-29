# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Secret erasure shared by every UI-session revocation path."""
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session
from app.db.openstack import OpenStackSession, OpenStackProjectCredential


def erase_openstack_sessions(db: Session, auth_session_ids: list[str]) -> None:
    if not auth_session_ids:
        return
    sessions = select(OpenStackSession.id).where(OpenStackSession.auth_session_id.in_(auth_session_ids))
    db.execute(delete(OpenStackProjectCredential).where(OpenStackProjectCredential.session_id.in_(sessions)))
    db.execute(update(OpenStackSession).where(OpenStackSession.auth_session_id.in_(auth_session_ids)).values(token=None))
