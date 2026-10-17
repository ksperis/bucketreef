# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.domain_errors import S3AccountNotFoundError
from app.db import S3Account
from app.models.app_settings import PortalSettingsAdminUpdate, PortalSettingsOverride
from app.models.portal_settings import PortalAccountSettings
from app.services.portal_service import PortalService, get_portal_service


_DELEGATION_FIELDS = {
    "delegated_to_portal_managers",
    "portal_collaborator_role_management_delegated",
    "portal_collaborator_addition_delegated",
}


@dataclass(frozen=True)
class AdminAccountPortalSettingsUpdateResult:
    account: S3Account
    override: PortalSettingsOverride
    settings: PortalAccountSettings


class AdminAccountPortalSettingsService:
    """Resolve managed accounts and orchestrate Admin-owned Portal settings."""

    def __init__(self, db: Session, portal: PortalService | None = None) -> None:
        self.db = db
        self.portal = portal if portal is not None else get_portal_service(db)

    def _account(self, account_id: int) -> S3Account:
        account = self.db.query(S3Account).filter(S3Account.id == account_id).first()
        if account is None:
            raise S3AccountNotFoundError("S3Account not found")
        return account

    def get(self, account_id: int) -> PortalAccountSettings:
        return self.portal.get_portal_account_settings(self._account(account_id))

    def update(
        self,
        account_id: int,
        payload: PortalSettingsAdminUpdate,
    ) -> AdminAccountPortalSettingsUpdateResult:
        account = self._account(account_id)
        override_fields = payload.model_fields_set - _DELEGATION_FIELDS
        if not override_fields and payload.model_fields_set.intersection(_DELEGATION_FIELDS):
            override = self.portal.get_portal_account_settings(account).admin_override
        else:
            override = PortalSettingsOverride.model_validate(
                payload.model_dump(
                    exclude=_DELEGATION_FIELDS,
                    exclude_unset=True,
                    exclude_none=False,
                )
            )
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
