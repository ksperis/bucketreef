# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Optional

from app.core.db_transactions import commit_or_rollback
from app.db import S3Account
from app.models.app_settings import (
    PortalBucketDefaults,
    PortalBucketDefaultsOverride,
    PortalSettings,
    PortalEffectiveSettings,
    PortalSettingsOverride,
)
from app.models.feature_policy import FeaturePolicy, PORTAL_FEATURE_FIELDS, resolve_feature_policy
from app.services.portal.exceptions import PortalForbiddenError
from app.models.portal_settings import PortalAccountSettings, PortalProjectSettings
from app.services.app_settings_service import load_app_settings_for_db


class PortalSettingsMixin:
    def _portal_settings(self) -> PortalSettings:
        return load_app_settings_for_db(self.db).portal

    def _load_portal_settings_override(
        self,
        account: S3Account,
    ) -> PortalSettingsOverride:
        raw = account.portal_settings_override
        if raw is None:
            return PortalSettingsOverride()
        return PortalSettingsOverride.model_validate(raw, strict=True)

    def _persist_portal_settings_override(
        self,
        account: S3Account,
        override: PortalSettingsOverride,
        *,
        delegated_to_portal_managers: Optional[bool] = None,
        portal_collaborator_role_management_delegated: Optional[bool] = None,
        portal_collaborator_addition_delegated: Optional[bool] = None,
    ) -> None:
        payload = override.model_dump(exclude_unset=True, exclude_none=True)
        account.portal_settings_override = payload or None
        if delegated_to_portal_managers is not None:
            account.portal_settings_delegated = delegated_to_portal_managers
        if portal_collaborator_role_management_delegated is not None:
            account.portal_collaborator_role_management_delegated = (
                portal_collaborator_role_management_delegated
            )
        if portal_collaborator_addition_delegated is not None:
            account.portal_collaborator_addition_delegated = (
                portal_collaborator_addition_delegated
            )
        self.db.add(account)
        commit_or_rollback(self.db)
        self.db.refresh(account)

    def _apply_bucket_defaults_override(
        self,
        target: PortalBucketDefaults,
        override: Optional[PortalBucketDefaultsOverride],
    ) -> None:
        if not override:
            return
        if override.versioning is not None:
            target.versioning = override.versioning
        if override.enable_cors is not None:
            target.enable_cors = override.enable_cors
        if override.enable_lifecycle is not None:
            target.enable_lifecycle = override.enable_lifecycle
        if override.noncurrent_version_expiration_days is not None:
            target.noncurrent_version_expiration_days = override.noncurrent_version_expiration_days
        if override.cors_allowed_origins is not None:
            target.cors_allowed_origins = override.cors_allowed_origins

    def _apply_override(
        self,
        portal_settings: PortalEffectiveSettings,
        override: PortalSettingsOverride,
    ) -> None:
        for field, feature in PORTAL_FEATURE_FIELDS.items():
            state = resolve_feature_policy(getattr(portal_settings.feature_policies, feature), getattr(override, field))
            setattr(portal_settings, field, state.enabled)
        if override.bucket_defaults:
            self._apply_bucket_defaults_override(
                portal_settings.bucket_defaults,
                override.bucket_defaults,
            )

    def get_effective_portal_settings(
        self,
        account: S3Account,
        *,
        base_settings: Optional[PortalSettings] = None,
    ) -> PortalEffectiveSettings:
        base = base_settings or self._portal_settings()
        override = self._load_portal_settings_override(account)
        effective = PortalEffectiveSettings(**base.model_dump())
        self._apply_override(effective, override)
        return effective

    def get_portal_account_settings(self, account: S3Account) -> PortalAccountSettings:
        base = self._portal_settings()
        admin_override = self._load_portal_settings_override(account)
        effective = PortalEffectiveSettings(**base.model_dump())
        self._apply_override(effective, admin_override)
        return PortalAccountSettings(
            effective=effective,
            feature_states={field: resolve_feature_policy(getattr(base.feature_policies, feature), getattr(admin_override, field))
                            for field, feature in PORTAL_FEATURE_FIELDS.items()},
            admin_override=admin_override,
            delegated_to_portal_managers=account.portal_settings_delegated,
            portal_collaborator_role_management_delegated=(
                account.portal_collaborator_role_management_delegated
            ),
            portal_collaborator_addition_delegated=(
                account.portal_collaborator_addition_delegated
            ),
        )

    def get_portal_project_settings(
        self,
        account: S3Account,
        *,
        can_update: bool,
    ) -> PortalProjectSettings:
        account_settings = self.get_portal_account_settings(account)
        return PortalProjectSettings(
            effective=account_settings.effective,
            feature_states=account_settings.feature_states,
            project_override=account_settings.admin_override,
            delegated_to_portal_managers=account_settings.delegated_to_portal_managers,
            portal_collaborator_role_management_delegated=(
                account_settings.portal_collaborator_role_management_delegated
            ),
            portal_collaborator_addition_delegated=(
                account_settings.portal_collaborator_addition_delegated
            ),
            can_update=can_update,
        )

    def update_admin_portal_settings_override(
        self,
        account: S3Account,
        override: PortalSettingsOverride,
        *,
        delegated_to_portal_managers: Optional[bool] = None,
        portal_collaborator_role_management_delegated: Optional[bool] = None,
        portal_collaborator_addition_delegated: Optional[bool] = None,
    ) -> PortalAccountSettings:
        base = self._portal_settings()
        previous = self._load_portal_settings_override(account)
        for field, feature in PORTAL_FEATURE_FIELDS.items():
            if (getattr(base.feature_policies, feature) == FeaturePolicy.DISABLED
                    and getattr(override, field) is True and getattr(previous, field) is not True):
                raise PortalForbiddenError("This feature is disabled by the platform")
        previous_effective = PortalEffectiveSettings(**base.model_dump())
        self._apply_override(previous_effective, previous)
        effective = PortalEffectiveSettings(**base.model_dump())
        self._apply_override(effective, override)
        logging_changed = (
            previous_effective.server_access_logging_enabled
            != effective.server_access_logging_enabled
        )
        logging_snapshot = None
        if logging_changed:
            logging_snapshot = self._capture_portal_server_access_logging_state(account)
        try:
            if logging_changed:
                source_buckets = (
                    list(logging_snapshot.source_logging)
                    if logging_snapshot is not None
                    else []
                )
                self._apply_portal_server_access_logging_reconcile(
                    account,
                    portal_settings=effective,
                    source_buckets=source_buckets,
                )
            self._persist_portal_settings_override(
                account,
                override,
                delegated_to_portal_managers=delegated_to_portal_managers,
                portal_collaborator_role_management_delegated=(
                    portal_collaborator_role_management_delegated
                ),
                portal_collaborator_addition_delegated=portal_collaborator_addition_delegated,
            )
        except Exception as exc:
            if logging_snapshot is not None:
                try:
                    self._restore_portal_server_access_logging_state(account, logging_snapshot)
                except Exception as rollback_exc:  # pragma: no cover - defensive remote failure
                    raise RuntimeError(
                        "Unable to update Portal settings. "
                        "Server Access Logging rollback also failed."
                    ) from exc
            raise
        return self.get_portal_account_settings(account)
