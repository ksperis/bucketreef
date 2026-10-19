# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import binascii
import re
from io import BytesIO
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import Field, field_validator, model_validator
from reportlab.lib.utils import ImageReader

from app.core.config import get_settings
from app.models.base import ApiModel
from app.models.feature_policy import (
    ManagerFeaturePolicies,
    PortalFeaturePolicies,
    ProjectCollectionPolicies,
    ProjectFeaturePolicies,
)
from app.models.storage_endpoint import StorageEndpointPublic


DEFAULT_DOCUMENTATION_BASE_URL = "https://docs.bucketreef.ksperis.com"


def _default_portal_cors_origins() -> list[str]:
    return list(get_settings().cors_origins or [])


def _default_bucket_migration_parallelism_max() -> int:
    return get_settings().bucket_migration_parallelism_max


def _default_bucket_migration_max_active_per_endpoint() -> int:
    return get_settings().bucket_migration_max_active_per_endpoint


class PortalBucketDefaultsOverride(ApiModel):
    versioning: Optional[bool] = None
    enable_cors: Optional[bool] = None
    enable_lifecycle: Optional[bool] = None
    noncurrent_version_expiration_days: Optional[int] = Field(default=None, ge=1)
    cors_allowed_origins: Optional[list[str]] = None


class PortalSettingsOverride(ApiModel):
    browser_access_enabled: Optional[bool] = None
    allow_private_storage_space_create: Optional[bool] = None
    allow_portal_named_bucket_create: Optional[bool] = None
    allow_portal_user_access_key_create: Optional[bool] = None
    allow_portal_user_external_sharing: Optional[bool] = None
    server_access_logging_enabled: Optional[bool] = None
    storage_space_version_cleanup_enabled: Optional[bool] = None
    bucket_defaults: Optional[PortalBucketDefaultsOverride] = None


class PortalSettingsAdminUpdate(PortalSettingsOverride):
    delegated_to_portal_managers: Optional[bool] = None
    portal_collaborator_role_management_delegated: Optional[bool] = None
    portal_collaborator_addition_delegated: Optional[bool] = None


class PortalBucketDefaults(ApiModel):
    versioning: bool = True
    enable_cors: bool = True
    enable_lifecycle: bool = True
    noncurrent_version_expiration_days: int = Field(default=90, ge=1)
    cors_allowed_origins: list[str] = Field(default_factory=_default_portal_cors_origins)


class GeneralSettings(ApiModel):
    project_feature_policies: ProjectFeaturePolicies = Field(default_factory=ProjectFeaturePolicies)
    project_collection_policies: ProjectCollectionPolicies = Field(default_factory=ProjectCollectionPolicies)
    rgw_account_id_prefix: str = Field(default="80", pattern=r"^\d{1,3}$")
    documentation_base_url: str = DEFAULT_DOCUMENTATION_BASE_URL
    manager_enabled: bool = True
    ceph_admin_enabled: bool = False
    storage_ops_enabled: bool = False
    browser_enabled: bool = True
    browser_root_enabled: bool = True
    browser_manager_enabled: bool = False
    browser_portal_enabled: bool = True
    browser_ceph_admin_enabled: bool = False
    portal_enabled: bool = False
    billing_enabled: bool = False
    endpoint_status_enabled: bool = True
    quota_alerts_enabled: bool = False
    usage_history_enabled: bool = True
    allow_login_access_keys: bool = False
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False
    require_passkey_for_admins: bool = False
    require_passkey_for_users: bool = False
    allow_user_profile_name_edit: bool = False
    allow_user_external_identity_unlink: bool = False

    @field_validator("documentation_base_url", mode="before")
    @classmethod
    def normalize_documentation_base_url(cls, value: Optional[str]) -> str:
        if value is None:
            return DEFAULT_DOCUMENTATION_BASE_URL
        if not isinstance(value, str):
            raise ValueError("documentation_base_url must be a string")
        normalized = value.strip()
        if not normalized:
            return DEFAULT_DOCUMENTATION_BASE_URL
        parsed = urlparse(normalized)
        if normalized.startswith("//"):
            raise ValueError("documentation_base_url must be an http(s) or root-relative URL")
        if normalized.startswith("/"):
            if parsed.query or parsed.fragment:
                raise ValueError("documentation_base_url must not contain a query string or fragment")
            return normalized.rstrip("/") or "/"
        if (
            parsed.scheme in {"http", "https"}
            and bool(parsed.netloc)
            and not parsed.query
            and not parsed.fragment
        ):
            return normalized.rstrip("/")
        raise ValueError("documentation_base_url must be an http(s) or root-relative URL")


class GeneralSettingsView(GeneralSettings):
    """Read-only settings projection for authenticated workspace consumers."""
    manager_feature_policies: ManagerFeaturePolicies = Field(default_factory=ManagerFeaturePolicies)

    @classmethod
    def from_settings(cls, settings: "AppSettings") -> "GeneralSettingsView":
        return cls(
            **settings.general.model_dump(),
            manager_feature_policies=settings.manager.feature_policies,
        )


class GeneralFeatureLock(ApiModel):
    forced: bool = False
    value: Optional[bool] = None
    source: Optional[str] = None


class GeneralFeatureLocks(ApiModel):
    manager_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    ceph_admin_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    storage_ops_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    browser_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    portal_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    billing_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)
    endpoint_status_enabled: GeneralFeatureLock = Field(default_factory=GeneralFeatureLock)


class BrandingSettings(ApiModel):
    primary_color: str = "#0569f8"
    login_logo_url: Optional[str] = None

    @field_validator("primary_color", mode="before")
    @classmethod
    def normalize_primary_color(cls, value: Optional[str]) -> str:
        if value is None:
            return "#0569f8"
        if not isinstance(value, str):
            raise ValueError("primary_color must be a string")
        normalized = value.strip().lower()
        if not normalized:
            return "#0569f8"
        if not re.fullmatch(r"#[0-9a-f]{6}", normalized):
            raise ValueError("primary_color must be a hex color in #rrggbb format")
        return normalized

    @field_validator("login_logo_url", mode="before")
    @classmethod
    def normalize_login_logo_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("login_logo_url must be a string")
        normalized = value.strip()
        if not normalized:
            return None
        if normalized.startswith("/"):
            return normalized
        if normalized.startswith("data:image/"):
            return normalized
        parsed = urlparse(normalized)
        if parsed.scheme in {"http", "https"} and bool(parsed.netloc):
            return normalized
        raise ValueError("login_logo_url must be http(s), root-relative (/...), or data:image/... URL")


class LoginSettings(ApiModel):
    allow_login_access_keys: bool = False
    allow_login_endpoint_list: bool = False
    allow_login_custom_endpoint: bool = False
    default_endpoint_url: Optional[str] = None
    endpoints: list[StorageEndpointPublic] = Field(default_factory=list)
    login_logo_url: Optional[str] = None


class PortalSettings(ApiModel):
    feature_policies: PortalFeaturePolicies = Field(default_factory=PortalFeaturePolicies)
    server_access_log_retention_days: int = Field(default=30, ge=1)
    max_portal_user_access_keys: int = Field(default=2, ge=1)
    bucket_defaults: PortalBucketDefaults = Field(default_factory=PortalBucketDefaults)


class PortalEffectiveSettings(PortalSettings):
    browser_access_enabled: bool = True
    allow_private_storage_space_create: bool = True
    allow_portal_named_bucket_create: bool = False
    allow_portal_user_access_key_create: bool = True
    allow_portal_user_external_sharing: bool = False
    server_access_logging_enabled: bool = True
    storage_space_version_cleanup_enabled: bool = True


class ManagerSettings(ApiModel):
    feature_policies: ManagerFeaturePolicies = Field(default_factory=ManagerFeaturePolicies)
    bucket_migration_parallelism_default: int = Field(
        default_factory=_default_bucket_migration_parallelism_max,
        ge=1,
        le=128,
    )
    bucket_migration_parallelism_max: int = Field(
        default_factory=_default_bucket_migration_parallelism_max,
        ge=1,
        le=128,
    )
    bucket_migration_max_active_per_endpoint: int = Field(
        default_factory=_default_bucket_migration_max_active_per_endpoint,
        ge=1,
        le=64,
    )

    @model_validator(mode="after")
    def validate_bucket_migration_limits(self):
        if self.bucket_migration_parallelism_default > self.bucket_migration_parallelism_max:
            raise ValueError("bucket_migration_parallelism_default must be <= bucket_migration_parallelism_max")
        return self


class QuotaNotificationSettings(ApiModel):
    threshold_percent: int = Field(default=85, ge=1, le=100)
    include_subject_contact_email: bool = False
    smtp_host: Optional[str] = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: Optional[str] = None
    smtp_from_email: Optional[str] = None
    smtp_from_name: Optional[str] = None
    smtp_starttls: bool = True
    smtp_timeout_seconds: int = Field(default=15, ge=1, le=300)

    @field_validator("smtp_host", "smtp_username", "smtp_from_email", "smtp_from_name", mode="before")
    @classmethod
    def normalize_optional_strings(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("SMTP settings must be strings")
        normalized = value.strip()
        return normalized or None


class BrowserSettings(ApiModel):
    allow_proxy_transfers: bool = True
    direct_upload_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_upload_parallelism: int = Field(default=2, ge=1, le=20)
    direct_download_parallelism: int = Field(default=5, ge=1, le=20)
    proxy_download_parallelism: int = Field(default=2, ge=1, le=20)
    other_operations_parallelism: int = Field(default=3, ge=1, le=20)
    streaming_zip_threshold_mb: int = Field(default=200, ge=0, le=10240)


class OnboardingSettings(ApiModel):
    dismissed: bool = False


class BillingAutomationSettings(ApiModel):
    mode: Literal["manual", "automatic_draft", "automatic_finalize"] = "manual"
    schedule_day: int = Field(default=5, ge=1, le=28)
    require_all_subjects_assigned: bool = True


class BillingStatementPdfSettings(ApiModel):
    organization_name: str = Field(default="BucketReef", min_length=1, max_length=160)
    organization_details: Optional[str] = Field(default=None, max_length=600)
    accent_color: str = "#0569f8"
    logo_data_url: Optional[str] = Field(default=None, max_length=750_000)
    statement_note: Optional[str] = Field(default=None, max_length=1200)
    footer_text: Optional[str] = Field(default=None, max_length=500)

    @field_validator("organization_name", mode="before")
    @classmethod
    def normalize_pdf_organization_name(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("organization_name must be a string")
        normalized = value.strip()
        if not normalized:
            raise ValueError("organization_name is required")
        return normalized

    @field_validator("organization_details", "statement_note", "footer_text", mode="before")
    @classmethod
    def normalize_pdf_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("PDF text settings must be strings")
        normalized = value.strip()
        return normalized or None

    @field_validator("accent_color", mode="before")
    @classmethod
    def normalize_pdf_accent_color(cls, value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("accent_color must be a string")
        normalized = value.strip().lower()
        if not re.fullmatch(r"#[0-9a-f]{6}", normalized):
            raise ValueError("accent_color must be a hex color in #rrggbb format")
        return normalized

    @field_validator("logo_data_url", mode="before")
    @classmethod
    def normalize_pdf_logo(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("logo_data_url must be a string")
        normalized = value.strip()
        if not normalized:
            return None
        match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)", normalized)
        if match is None:
            raise ValueError("logo_data_url must contain an embedded PNG or JPEG image")
        try:
            decoded = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("logo_data_url contains invalid base64 image data") from exc
        if len(decoded) > 512 * 1024:
            raise ValueError("PDF logo must not exceed 512 KiB")
        image_kind = match.group(1)
        if image_kind == "png" and not decoded.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("logo_data_url does not contain a valid PNG signature")
        if image_kind == "jpeg" and not decoded.startswith(b"\xff\xd8"):
            raise ValueError("logo_data_url does not contain a valid JPEG signature")
        try:
            width, height = ImageReader(BytesIO(decoded)).getSize()
        except Exception as exc:
            raise ValueError("logo_data_url does not contain a readable image") from exc
        if width <= 0 or height <= 0 or width > 4096 or height > 4096:
            raise ValueError("PDF logo dimensions must be between 1 and 4096 pixels")
        return normalized


class AppSettings(ApiModel):
    general: GeneralSettings = Field(default_factory=GeneralSettings)
    portal: PortalSettings = Field(default_factory=PortalSettings)
    manager: ManagerSettings = Field(default_factory=ManagerSettings)
    quota_notifications: QuotaNotificationSettings = Field(default_factory=QuotaNotificationSettings)
    browser: BrowserSettings = Field(default_factory=BrowserSettings)
    billing_automation: BillingAutomationSettings = Field(default_factory=BillingAutomationSettings)
    billing_statement_pdf: BillingStatementPdfSettings = Field(default_factory=BillingStatementPdfSettings)
    onboarding: OnboardingSettings = Field(default_factory=OnboardingSettings)
    branding: BrandingSettings = Field(default_factory=BrandingSettings)
