# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import sqlalchemy as sa

from app.db import AppSetting
from app.models.app_settings import AppSettings, PortalEffectiveSettings
from app.models.feature_policy import FeaturePolicy, PORTAL_FEATURE_FIELDS, PortalFeaturePolicies


def enable_manager_features(db_session):
    """Permission scenarios explicitly opt into the features whose grants they test."""
    settings = AppSettings()
    for name in type(settings.manager.feature_policies).model_fields:
        setattr(settings.manager.feature_policies, name, FeaturePolicy.TARGETED)
    row = db_session.scalar(sa.select(AppSetting).where(AppSetting.key == "default"))
    if row is None:
        db_session.add(AppSetting(key="default", payload_json=settings.model_dump_json()))
    else:
        row.payload_json = settings.model_dump_json()
    db_session.commit()
    return settings


def portal_settings_fixture(**values):
    policies = PortalFeaturePolicies()
    for field, feature in PORTAL_FEATURE_FIELDS.items():
        if field in values:
            setattr(policies, feature, FeaturePolicy.DEFAULT_ON if values[field] else FeaturePolicy.TARGETED)
    return PortalEffectiveSettings(feature_policies=policies, **values)


def manager_settings_fixture(**values):
    settings = AppSettings()
    for feature, value in values.items():
        setattr(
            settings.manager.feature_policies,
            feature,
            FeaturePolicy.TARGETED if value else FeaturePolicy.DISABLED,
        )
    return settings
