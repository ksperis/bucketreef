# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Materialize static defaults in the canonical application settings row.

Revision ID: 0258_canonical_static_app_settings
Revises: 0257_remove_obsolete_onboarding_setting
Create Date: 2026-11-06
"""

from __future__ import annotations

from copy import deepcopy

from alembic import op
import sqlalchemy as sa


revision = "0258_canonical_static_app_settings"
down_revision = "0257_remove_obsolete_onboarding_setting"
branch_labels = None
depends_on = None


_SETTINGS_KEY = "default"
_STATIC_DEFAULTS = {
    "general": {
        "project_feature_policies": {"bucket_usage_stats": "default_on"},
        "project_collection_policies": {"bucket_usage_stats": "targeted"},
        "rgw_account_id_prefix": "80",
        "allow_managed_rgw_tenant_creation": False,
        "documentation_base_url": "https://docs.bucketreef.ksperis.com",
        "manager_enabled": True,
        "openstack_enabled": False,
        "ceph_admin_enabled": False,
        "storage_ops_enabled": False,
        "browser_enabled": True,
        "browser_root_enabled": True,
        "browser_manager_enabled": False,
        "browser_portal_enabled": True,
        "browser_ceph_admin_enabled": False,
        "portal_enabled": False,
        "cost_enabled": False,
        "endpoint_status_enabled": True,
        "quota_alerts_enabled": False,
        "usage_history_enabled": True,
        "allow_login_access_keys": False,
        "allow_login_endpoint_list": False,
        "allow_login_custom_endpoint": False,
        "require_passkey_for_admins": False,
        "require_passkey_for_users": False,
        "allow_user_profile_name_edit": False,
        "allow_user_external_identity_link": False,
        "allow_user_external_identity_unlink": False,
    },
    "portal": {
        "feature_policies": {
            "cost_estimation": "targeted",
            "browser_access": "default_on",
            "private_storage_space_create": "default_on",
            "named_bucket_create": "targeted",
            "user_access_key_create": "default_on",
            "user_external_sharing": "targeted",
            "server_access_logging": "default_on",
            "storage_space_version_cleanup": "default_on",
        },
        "server_access_log_retention_days": 30,
        "max_portal_user_access_keys": 2,
        "bucket_defaults": {
            "versioning": True,
            "enable_cors": True,
            "enable_lifecycle": True,
            "noncurrent_version_expiration_days": 90,
        },
    },
    "manager": {
        "feature_policies": {
            "rgw_usage_metrics": "default_on",
            "cost_estimation": "targeted",
            "activity_history": "default_on",
            "bucket_compare": "targeted",
            "bucket_integrity_check": "targeted",
            "bucket_migration": "disabled",
            "bucket_purge": "disabled",
            "feature_rules": "targeted",
            "bucket_quota_management": "disabled",
            "ceph_s3_user_keys": "targeted",
            "access_key_metadata": "targeted",
            "access_key_expiration": "targeted",
            "managed_private_connection_provisioning": "disabled",
            "rgw_multisite_endpoint_switching": "targeted",
        }
    },
    "quota_notifications": {
        "threshold_percent": 85,
        "include_subject_contact_email": False,
        "smtp_host": None,
        "smtp_port": 587,
        "smtp_username": None,
        "smtp_from_email": None,
        "smtp_from_name": None,
        "smtp_starttls": True,
        "smtp_timeout_seconds": 15,
    },
    "browser": {
        "allow_direct_uploads": True,
        "allow_sts_uploads": True,
        "allow_proxy_transfers": True,
        "direct_upload_parallelism": 5,
        "proxy_upload_parallelism": 2,
        "direct_download_parallelism": 5,
        "proxy_download_parallelism": 2,
        "other_operations_parallelism": 3,
        "streaming_zip_threshold_mb": 200,
    },
    "branding": {
        "primary_color": "#0569f8",
        "login_logo_url": None,
    },
}

app_settings = sa.table(
    "app_settings",
    sa.column("key", sa.String()),
    sa.column("payload", sa.JSON()),
)


def _merge_missing(target: dict, defaults: dict, *, location: str) -> bool:
    changed = False
    for key, default in defaults.items():
        if key not in target:
            target[key] = deepcopy(default)
            changed = True
            continue
        if not isinstance(default, dict):
            continue
        nested = target[key]
        if not isinstance(nested, dict):
            raise ValueError(f"{location}.{key} must contain a JSON object")
        changed = _merge_missing(
            nested,
            default,
            location=f"{location}.{key}",
        ) or changed
    return changed


def upgrade() -> None:
    bind = op.get_bind()
    payload = bind.scalar(
        sa.select(app_settings.c.payload).where(app_settings.c.key == _SETTINGS_KEY)
    )
    if payload is None:
        return
    if not isinstance(payload, dict):
        raise ValueError("app_settings[default].payload must contain a JSON object")
    if not _merge_missing(
        payload,
        _STATIC_DEFAULTS,
        location="app_settings[default].payload",
    ):
        return
    bind.execute(
        app_settings.update()
        .where(app_settings.c.key == _SETTINGS_KEY)
        .values(payload=payload)
    )


def downgrade() -> None:
    # Existing values cannot be distinguished from defaults materialized here.
    pass
