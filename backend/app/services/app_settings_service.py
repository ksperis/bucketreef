# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.config import get_settings
from app.core.db_transactions import add_and_flush_in_savepoint, run_replayable_db_unit
from app.db import AppSetting, DeploymentConfiguration
from app.models.app_settings import AppSettings, GeneralFeatureLock, GeneralFeatureLocks
from app.services.deployment_configuration_state import (
    DEPLOYMENT_CONFIGURATION_KEY,
    DEPLOYMENT_CONFIGURATION_SOURCE,
    lock_deployment_configuration,
)
from app.utils.time import utcnow

APP_SETTINGS_DB_KEY = "default"
_PERSISTED_ENV_DEFAULT_PATHS = {
    ("portal", "bucket_defaults", "cors_allowed_origins"),
    ("manager", "bucket_migration_parallelism_default"),
    ("manager", "bucket_migration_parallelism_max"),
    ("manager", "bucket_migration_max_active_per_endpoint"),
}


class AppSettingsLoadError(RuntimeError):
    """Expected failure while loading persisted application settings."""


def _settings_path() -> Path | None:
    settings = get_settings()
    if settings.app_settings_path:
        return Path(settings.app_settings_path)
    return None


def _load_persisted_settings_from_disk(settings_path: Path | None) -> AppSettings:
    if settings_path is None or not settings_path.exists():
        return AppSettings()
    data = json.loads(settings_path.read_text(encoding="utf-8"))
    return AppSettings.model_validate(data)


def _missing_canonical_paths(
    payload: dict,
    canonical: dict,
    *,
    prefix: tuple[str, ...] = (),
) -> list[str]:
    missing: list[str] = []
    for key, canonical_value in canonical.items():
        path = (*prefix, key)
        if path in _PERSISTED_ENV_DEFAULT_PATHS:
            continue
        if key not in payload:
            missing.append(".".join(path))
            continue
        if isinstance(canonical_value, dict) and isinstance(payload[key], dict):
            missing.extend(
                _missing_canonical_paths(
                    payload[key],
                    canonical_value,
                    prefix=path,
                )
            )
    return missing


def _open_settings_session():
    from app.core.database import SessionLocal

    return SessionLocal()


def _parse_settings_payload(payload: object) -> AppSettings:
    if not isinstance(payload, dict):
        raise ValueError("Persisted application settings must contain a JSON object")
    settings = AppSettings.model_validate(payload)
    missing = _missing_canonical_paths(
        payload,
        settings.model_dump(mode="json"),
    )
    if missing:
        raise ValueError(
            "Persisted application settings are missing canonical fields: "
            + ", ".join(missing)
        )
    return settings


def _settings_to_payload(settings: AppSettings) -> dict:
    return settings.model_dump(mode="json")


def _get_persisted_settings_row(db) -> AppSetting | None:
    return db.scalar(
        select(AppSetting).where(AppSetting.key == APP_SETTINGS_DB_KEY).execution_options(populate_existing=True)
    )


def _save_persisted_settings_to_db(db, settings: AppSettings) -> None:
    payload = _settings_to_payload(settings)
    now = utcnow()

    def persist_once(write_db) -> None:
        row = _get_persisted_settings_row(write_db)
        if row is None:
            row = AppSetting(
                key=APP_SETTINGS_DB_KEY,
                payload=payload,
                created_at=now,
                updated_at=now,
            )
            try:
                add_and_flush_in_savepoint(write_db, row)
            except IntegrityError:
                row = _get_persisted_settings_row(write_db)
                if row is None:
                    raise
        row.payload = payload
        row.updated_at = now

    run_replayable_db_unit(db, persist_once)


def _load_persisted_settings_from_db(db) -> AppSettings:
    try:
        row = _get_persisted_settings_row(db)
        if row is None:
            raise AppSettingsLoadError("Application settings have not been initialized")
        return _parse_settings_payload(row.payload)
    except AppSettingsLoadError:
        raise
    except (SQLAlchemyError, ValueError) as exc:
        raise AppSettingsLoadError("Application settings could not be loaded") from exc


def get_general_feature_locks(db) -> GeneralFeatureLocks:
    snapshot = db.execute(
        select(DeploymentConfiguration.locked_features, AppSetting.payload)
        .select_from(DeploymentConfiguration)
        .outerjoin(AppSetting, AppSetting.key == APP_SETTINGS_DB_KEY)
        .where(DeploymentConfiguration.key == DEPLOYMENT_CONFIGURATION_KEY)
    ).one_or_none()
    if snapshot is None or not snapshot.locked_features:
        return GeneralFeatureLocks()
    try:
        general = _parse_settings_payload(snapshot.payload).general
    except ValueError as exc:
        raise AppSettingsLoadError("Application settings could not be loaded") from exc
    return GeneralFeatureLocks(**{
        field: GeneralFeatureLock(
            forced=True, value=getattr(general, field), source=DEPLOYMENT_CONFIGURATION_SOURCE
        )
        for field in snapshot.locked_features
    })


def load_app_settings_for_db(db) -> AppSettings:
    return _load_persisted_settings_from_db(db)


def bootstrap_app_settings_for_db(db) -> AppSettings:
    row = _get_persisted_settings_row(db)
    if row is not None:
        return _parse_settings_payload(row.payload)
    persisted = _load_persisted_settings_from_disk(_settings_path())
    _save_persisted_settings_to_db(db, persisted)
    return persisted


def load_default_app_settings() -> AppSettings:
    return AppSettings()


def load_app_settings() -> AppSettings:
    with _open_settings_session() as db:
        return load_app_settings_for_db(db)


class DeploymentFeatureLockedError(ValueError):
    pass


def require_editable_features(settings: AppSettings, current: AppSettings, locked: list[str]) -> None:
    for field in locked:
        if getattr(settings.general, field) != getattr(current.general, field):
            raise DeploymentFeatureLockedError(f"{field} is managed by the deployment.")


def save_app_settings_for_db(db, settings: AppSettings) -> AppSettings:
    def save(write_db):
        state = lock_deployment_configuration(write_db)
        row = _get_persisted_settings_row(write_db)
        current = _parse_settings_payload(row.payload)
        require_editable_features(settings, current, state.locked_features)
        row.payload = _settings_to_payload(settings)
        row.updated_at = utcnow()

    run_replayable_db_unit(db, save)
    return settings


def enable_onboarding_features(db, fields: tuple[str, ...]) -> list[str]:
    """Patch only workspace prerequisites, respecting deployment locks and concurrent writes.

    In particular, this entry point cannot modify authentication, connection
    sharing, user permissions, or optional storage tools.
    """
    allowed = {
        "manager_enabled", "portal_enabled", "ceph_admin_enabled",
        "browser_enabled", "browser_root_enabled", "browser_manager_enabled",
        "browser_portal_enabled",
    }
    if not set(fields) <= allowed:
        raise ValueError("Unsupported onboarding feature")

    def persist_once(write_db) -> list[str]:
        state = lock_deployment_configuration(write_db)
        row = _get_persisted_settings_row(write_db)
        settings = _parse_settings_payload(row.payload)
        changed = []
        for field in fields:
            if getattr(settings.general, field):
                continue
            if field in state.locked_features:
                raise DeploymentFeatureLockedError(f"{field} is managed by the deployment.")
            setattr(settings.general, field, True)
            changed.append(field)
        if changed:
            row.payload = _settings_to_payload(settings)
            row.updated_at = utcnow()
        return changed

    return run_replayable_db_unit(db, persist_once)
