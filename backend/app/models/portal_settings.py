# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal account and project settings API contracts."""

from app.models.app_settings import PortalEffectiveSettings, PortalSettingsOverride
from app.models.base import ApiModel
from app.models.feature_policy import FeatureState


class PortalAccountSettings(ApiModel):
    effective: PortalEffectiveSettings
    feature_states: dict[str, FeatureState]
    admin_override: PortalSettingsOverride
    delegated_to_portal_managers: bool
    portal_collaborator_role_management_delegated: bool
    portal_collaborator_addition_delegated: bool


class PortalProjectSettings(ApiModel):
    effective: PortalEffectiveSettings
    feature_states: dict[str, FeatureState]
    project_override: PortalSettingsOverride
    delegated_to_portal_managers: bool
    portal_collaborator_role_management_delegated: bool
    portal_collaborator_addition_delegated: bool
    can_update: bool
