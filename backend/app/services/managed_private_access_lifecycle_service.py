# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Provisioning lifecycle coordination for managed private access."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess, User
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedPrivateAccessResult,
    ManagedRGWUserPrivateAccessRequest,
)
from app.services.managed_private_access_audit_service import (
    ManagedPrivateAccessAuditService,
)
from app.services.managed_private_access_connection_service import (
    ManagedPrivateAccessConnectionService,
)
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)
from app.services.managed_private_access_sources import ManagedPrivateAccessSource
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)


ManagedPrivateAccessRequest = ManagedIAMPrivateAccessRequest | ManagedRGWUserPrivateAccessRequest


class ManagedPrivateAccessLifecycleService:
    """Resolve idempotency and start durable managed-access provisioning."""

    def __init__(
        self,
        db: Session,
        *,
        audit: ManagedPrivateAccessAuditService | None = None,
        state: ManagedPrivateAccessStateService | None = None,
        queries: ManagedPrivateAccessQueryService | None = None,
        connection: ManagedPrivateAccessConnectionService | None = None,
    ) -> None:
        self.audit = audit or ManagedPrivateAccessAuditService(db)
        self.state = state or ManagedPrivateAccessStateService(db)
        self.queries = queries or ManagedPrivateAccessQueryService(db)
        self.connection = connection or ManagedPrivateAccessConnectionService(
            db,
            audit=self.audit,
            state=self.state,
        )

    def existing_result_for_source(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
        payload: ManagedPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult | None:
        existing = self.queries.active_for_source(
            user.id,
            source.kind,
            source.identifier,
        )
        if existing is None:
            return None
        return self.connection.resolve_existing(existing, payload)

    def start(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        provisioning = self.state.claim(user, source)
        self.audit.record(user, provisioning, "managed_private_access.provision.start")
        return provisioning
