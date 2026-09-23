# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from pathlib import Path

from app.core.config import get_settings
from app.db import AppSetting
from app.models.app_settings import AppSettings, GeneralFeatureLock, GeneralFeatureLocks
from app.utils.time import utcnow
from sqlalchemy.exc import IntegrityError

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[1] / "data" / "app_settings.json"
APP_SETTINGS_DB_KEY = "default"
_GENERAL_FEATURE_FIELDS = (
    "manager_enabled",
    "ceph_admin_enabled",
    "storage_ops_enabled",
    "browser_enabled",
    "portal_enabled",
    "billing_enabled",
    "endpoint_status_enabled",
)


def _settings_path() -> Path:
    settings = get_settings()
    if settings.app_settings_path:
        return Path(settings.app_settings_path)
    return DEFAULT_SETTINGS_PATH


def _load_persisted_settings_from_disk(settings_path: Path) -> AppSettings:
    if not settings_path.exists():
        return AppSettings()
    data = json.loads(settings_path.read_text(encoding="utf-8"))
    return AppSettings.model_validate(_normalize_legacy_persisted_settings(data))


def _open_settings_session():
    from app.core.database import SessionLocal

    return SessionLocal()


def _normalize_legacy_persisted_settings(data: object) -> object:
    """Keep the historical admin-passkey policy for payloads saved before the field existed."""
    if not isinstance(data, dict):
        return data
    normalized = dict(data)
    general = normalized.get("general")
    if "general" not in normalized:
        general = {}
    if isinstance(general, dict) and "require_passkey_for_admins" not in general:
        general = dict(general)
        general["require_passkey_for_admins"] = True
        normalized["general"] = general
    return normalized


def _parse_settings_payload(payload: str) -> AppSettings:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return AppSettings.model_validate_json(payload)
    return AppSettings.model_validate(_normalize_legacy_persisted_settings(data))


def _settings_to_json(settings: AppSettings) -> str:
    return settings.model_dump_json(indent=2)


def _save_persisted_settings_to_db(db, settings: AppSettings) -> None:
    now = utcnow()
    payload_json = _settings_to_json(settings)
    row = db.query(AppSetting).filter(AppSetting.key == APP_SETTINGS_DB_KEY).first()
    if row is None:
        row = AppSetting(
            key=APP_SETTINGS_DB_KEY,
            payload_json=payload_json,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        try:
            db.commit()
            return
        except IntegrityError:
            db.rollback()
            row = db.query(AppSetting).filter(AppSetting.key == APP_SETTINGS_DB_KEY).first()
            if row is None:
                raise
    row.payload_json = payload_json
    row.updated_at = now
    db.commit()


def _load_persisted_settings_from_db(db) -> AppSettings:
    row = db.query(AppSetting).filter(AppSetting.key == APP_SETTINGS_DB_KEY).first()
    if row is not None:
        return _parse_settings_payload(row.payload_json)

    imported = _load_persisted_settings_from_disk(_settings_path())
    _save_persisted_settings_to_db(db, imported)
    return imported


def get_general_feature_locks() -> GeneralFeatureLocks:
    settings = get_settings()
    locks = GeneralFeatureLocks()

    dedicated_sources = {
        "manager_enabled": ("feature_manager_enabled", "FEATURE_MANAGER_ENABLED"),
        "ceph_admin_enabled": ("feature_ceph_admin_enabled", "FEATURE_CEPH_ADMIN_ENABLED"),
        "storage_ops_enabled": ("feature_storage_ops_enabled", "FEATURE_STORAGE_OPS_ENABLED"),
        "browser_enabled": ("feature_browser_enabled", "FEATURE_BROWSER_ENABLED"),
        "portal_enabled": ("feature_portal_enabled", "FEATURE_PORTAL_ENABLED"),
        "billing_enabled": ("feature_billing_enabled", "FEATURE_BILLING_ENABLED"),
        "endpoint_status_enabled": ("feature_endpoint_status_enabled", "FEATURE_ENDPOINT_STATUS_ENABLED"),
    }
    for field_name, (settings_attr, env_name) in dedicated_sources.items():
        forced_value = getattr(settings, settings_attr)
        if forced_value is not None:
            setattr(
                locks,
                field_name,
                GeneralFeatureLock(forced=True, value=bool(forced_value), source=env_name),
            )

    return locks


def _apply_general_feature_overrides(settings: AppSettings) -> AppSettings:
    effective = settings.model_copy(deep=True)
    locks = get_general_feature_locks()
    for field_name in _GENERAL_FEATURE_FIELDS:
        lock = getattr(locks, field_name)
        if lock.forced and lock.value is not None:
            setattr(effective.general, field_name, bool(lock.value))
    return effective


def load_persisted_app_settings() -> AppSettings:
    with _open_settings_session() as db:
        return _load_persisted_settings_from_db(db)


def load_app_settings_for_db(db) -> AppSettings:
    """Load effective settings through an existing request transaction."""
    return _apply_general_feature_overrides(_load_persisted_settings_from_db(db))


def load_app_settings_for_db_readonly(db) -> AppSettings:
    """Load effective settings without importing defaults into the database."""
    row = db.query(AppSetting).filter(AppSetting.key == APP_SETTINGS_DB_KEY).first()
    persisted = (
        _parse_settings_payload(row.payload_json)
        if row is not None
        else _load_persisted_settings_from_disk(_settings_path())
    )
    return _apply_general_feature_overrides(persisted)


def load_default_app_settings() -> AppSettings:
    return _apply_general_feature_overrides(AppSettings())


def load_app_settings() -> AppSettings:
    with _open_settings_session() as db:
        return load_app_settings_for_db(db)


def save_app_settings(settings: AppSettings) -> AppSettings:
    with _open_settings_session() as db:
        persisted = _load_persisted_settings_from_db(db)
        to_save = settings.model_copy(deep=True)
        locks = get_general_feature_locks()
        for field_name in _GENERAL_FEATURE_FIELDS:
            lock = getattr(locks, field_name)
            if lock.forced:
                setattr(to_save.general, field_name, getattr(persisted.general, field_name))
        _save_persisted_settings_to_db(db, to_save)
        return _apply_general_feature_overrides(to_save)


def enable_onboarding_features(db, fields: tuple[str, ...]) -> list[str]:
    """Patch only workspace prerequisites, respecting ENV and concurrent writes.

    In particular, this entry point cannot modify authentication, connection
    sharing, user permissions, or optional storage tools.
    """
    allowed = {
        "manager_enabled", "portal_enabled", "ceph_admin_enabled",
        "browser_enabled", "browser_root_enabled", "browser_portal_enabled",
    }
    if not set(fields) <= allowed:
        raise ValueError("Unsupported onboarding feature")
    for _attempt in range(3):
        locks = get_general_feature_locks()
        for field in fields:
            lock = getattr(locks, field, None)
            if lock and lock.forced and lock.value is False:
                raise ValueError(f"Feature locked by {lock.source}")
        _load_persisted_settings_from_db(db)
        row = db.query(AppSetting).filter(AppSetting.key == APP_SETTINGS_DB_KEY).populate_existing().one()
        previous = row.payload_json
        settings = _parse_settings_payload(previous)
        changed = []
        for field in fields:
            lock = getattr(locks, field, None)
            if lock and lock.forced:
                continue
            if not getattr(settings.general, field):
                setattr(settings.general, field, True)
                changed.append(field)
        if not changed:
            return []
        updated = db.query(AppSetting).filter(
            AppSetting.key == APP_SETTINGS_DB_KEY,
            AppSetting.payload_json == previous,
        ).update({
            AppSetting.payload_json: _settings_to_json(settings),
            AppSetting.updated_at: utcnow(),
        }, synchronize_session=False)
        if updated:
            db.commit()
            db.expire(row)
            return changed
        db.rollback()
    raise ValueError("Settings changed concurrently; refresh and retry")
