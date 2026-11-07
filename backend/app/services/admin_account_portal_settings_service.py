# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import S3Account
from app.models.app_settings import PortalSettingsAdminUpdate, PortalSettingsOverride
from app.models.portal_settings import PortalAccountSettings
from app.services.portal_service import PortalService, get_portal_service
from app.services.s3_account_repository import S3AccountRepository


@dataclass(frozen=True)
class AdminAccountPortalSettingsUpdateResult:
    account: S3Account
    override: PortalSettingsOverride
    settings: PortalAccountSettings


class AdminAccountPortalSettingsService:
    """Resolve managed accounts and orchestrate Admin-owned Portal settings."""

    def __init__(self, db: Session, portal: PortalService | None = None) -> None:
        self.db = db
        self.accounts = S3AccountRepository(db)
        self.portal = portal if portal is not None else get_portal_service(db)

    def _account(self, account_id: int) -> S3Account:
        return self.accounts.get(account_id)

    def get(self, account_id: int) -> PortalAccountSettings:
        return self.portal.get_portal_account_settings(self._account(account_id))

    def update(
        self,
        account_id: int,
        payload: PortalSettingsAdminUpdate,
    ) -> AdminAccountPortalSettingsUpdateResult:
        account = self._account(account_id)
        if "override" not in payload.model_fields_set:
            override = self.portal.get_portal_account_settings(account).admin_override
        else:
            override = payload.override
            if override is None:  # Guarded by PortalSettingsAdminUpdate validation.
                raise ValueError("override cannot be null")
        settings = self.portal.update_admin_portal_settings_override(
            account,
            override,
            delegated_to_portal_managers=payload.delegated_to_portal_managers,
            portal_collaborator_role_management_delegated=(
                payload.portal_collaborator_role_management_delegated
            ),
            portal_collaborator_addition_delegated=payload.portal_collaborator_addition_delegated,
        )
        return AdminAccountPortalSettingsUpdateResult(
            account=account,
            override=override,
            settings=settings,
        )
