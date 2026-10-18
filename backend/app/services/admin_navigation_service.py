# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import (
    ExternalIdentityLinkRequest,
    PortalAdminRequest,
    User,
    is_superadmin_ui_role,
)
from app.models.admin_navigation import AdminPendingRequestCounts
from app.services.identity_security_policy import STANDARD_UI_ROLES
from app.utils.time import utcnow


class AdminNavigationService:
    @staticmethod
    def pending_request_counts(db: Session, actor: User) -> AdminPendingRequestCounts:
        identity_statement = (
            select(func.count(ExternalIdentityLinkRequest.id))
            .join(User, User.id == ExternalIdentityLinkRequest.user_id)
            .where(
                ExternalIdentityLinkRequest.status == "pending",
                ExternalIdentityLinkRequest.expires_at > utcnow(),
            )
        )
        if not is_superadmin_ui_role(actor.role):
            identity_statement = identity_statement.where(
                User.role.in_(STANDARD_UI_ROLES)
            )

        portal_count = db.scalar(
            select(func.count(PortalAdminRequest.id)).where(
                PortalAdminRequest.status == "pending"
            )
        )
        return AdminPendingRequestCounts(
            identity_link_requests=int(db.scalar(identity_statement) or 0),
            portal_requests=int(portal_count or 0),
        )
