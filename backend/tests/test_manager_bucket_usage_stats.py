# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.db import User, UserRole
from app.models.app_settings import AppSettings
from app.models.feature_policy import FeaturePolicy
from app.routers import dependencies as dependencies_router
from app.services import app_settings_service
from app.services.s3_execution_context import S3ExecutionContext


def _manager_user(*, role: str = UserRole.UI_USER.value) -> User:
    return User(
        email="usage-stats-tool@example.com",
        hashed_password="x",
        is_active=True,
        role=role,
    )


def _context() -> S3ExecutionContext:
    return S3ExecutionContext(
        context_id="conn-usage-stats",
        context_kind="connection",
        name="Usage stats",
        access_key="AK",
        secret_key="SK",
    )


def test_require_bucket_usage_stats_enabled_blocks_when_feature_disabled(monkeypatch, db_session):
    settings = AppSettings()
    settings.general.project_feature_policies.bucket_usage_stats = FeaturePolicy.DISABLED
    monkeypatch.setattr(app_settings_service, "load_app_settings_for_db_readonly", lambda _db: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_usage_stats_enabled(_manager_user(), _context(), db_session)

    assert exc.value.status_code == 403
    assert "bucket usage stats feature is disabled" in str(exc.value.detail).lower()


def test_require_bucket_usage_stats_enabled_blocks_non_manager_roles(monkeypatch, db_session):
    settings = AppSettings()
    settings.general.project_feature_policies.bucket_usage_stats = FeaturePolicy.DEFAULT_ON
    monkeypatch.setattr(app_settings_service, "load_app_settings_for_db_readonly", lambda _db: settings)

    with pytest.raises(HTTPException) as exc:
        dependencies_router.require_bucket_usage_stats_enabled(
            _manager_user(role=UserRole.UI_NONE.value), _context(), db_session
        )

    assert exc.value.status_code == 403
    assert str(exc.value.detail) == "Not authorized"


def test_bucket_composition_stats_remain_enabled_when_rgw_metrics_are_disabled(monkeypatch, db_session):
    settings = AppSettings()
    settings.general.project_feature_policies.bucket_usage_stats = FeaturePolicy.DEFAULT_ON
    settings.manager.feature_policies.rgw_usage_metrics = FeaturePolicy.DISABLED
    monkeypatch.setattr(app_settings_service, "load_app_settings_for_db_readonly", lambda _db: settings)

    assert (
        dependencies_router.require_bucket_usage_stats_enabled(_manager_user(), _context(), db_session).email
        == "usage-stats-tool@example.com"
    )
