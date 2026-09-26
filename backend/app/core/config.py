# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
import ipaddress
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings

from app.utils.ldap_validation import (
    LDAP_PROVIDER_DEFAULT_USER_FILTER,
    LDAP_PROVIDER_ID_PATTERN,
    normalize_optional_ldap_string,
    normalize_required_ldap_string,
    validate_ldap_url,
    validate_ldap_user_filter,
)


DeploymentProfile = Literal["full", "admin", "admin-no-ceph-admin", "user", "ceph-admin-high-security"]


class OIDCProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str
    discovery_url: str
    client_id: str
    client_secret: Optional[str] = None
    redirect_uri: str
    scopes: list[str] = Field(default_factory=lambda: ["openid", "email", "profile"])
    prompt: Optional[str] = None
    enabled: bool = True
    icon_url: Optional[str] = None
    use_pkce: bool = True
    use_nonce: bool = True
    linking_policy: Literal["manual", "trusted_email"] = "manual"
    trusted_email_domains: list[str] = Field(default_factory=list)
    allowed_algorithms: list[str] = Field(default_factory=lambda: ["RS256"])
    allowed_hosts: list[str] = Field(default_factory=list)

    @field_validator("scopes", mode="before")
    @classmethod
    def parse_scopes(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse scopes JSON") from exc
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("allowed_algorithms", "allowed_hosts", "trusted_email_domains", mode="before")
    @classmethod
    def parse_security_lists(cls, value):
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    return json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse OIDC security list JSON") from exc
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("trusted_email_domains")
    @classmethod
    def normalize_trusted_domains(cls, value: list[str]) -> list[str]:
        from app.models.oidc import normalize_trusted_email_domains

        return normalize_trusted_email_domains(value)

    @field_validator("allowed_algorithms")
    @classmethod
    def validate_allowed_algorithms(cls, value: list[str]) -> list[str]:
        allowed = {"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"}
        normalized = [str(item).strip().upper() for item in value]
        if not normalized or any(item not in allowed for item in normalized):
            raise ValueError("OIDC allowed_algorithms must contain supported asymmetric signature algorithms")
        return normalized


class LDAPProviderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str
    url: str
    bind_dn: Optional[str] = None
    bind_password: Optional[str] = None
    user_base_dn: str
    user_filter: str = LDAP_PROVIDER_DEFAULT_USER_FILTER
    email_attribute: str = "mail"
    name_attribute: Optional[str] = "displayName"
    subject_attribute: Optional[str] = None
    start_tls: bool = False
    tls_verify: bool = True
    tls_ca_file: Optional[str] = None
    allow_legacy_tls: bool = False
    timeout_seconds: float = Field(5.0, gt=0, le=60)
    enabled: bool = True
    allow_insecure: bool = False

    normalize_required_strings = field_validator(
        "display_name",
        "url",
        "user_base_dn",
        "user_filter",
        "email_attribute",
        mode="before",
    )(normalize_required_ldap_string)

    normalize_optional_strings = field_validator(
        "bind_dn",
        "bind_password",
        "name_attribute",
        "subject_attribute",
        "tls_ca_file",
        mode="before",
    )(normalize_optional_ldap_string)

    validate_url = field_validator("url")(validate_ldap_url)

    validate_user_filter = field_validator("user_filter")(validate_ldap_user_filter)

    @model_validator(mode="after")
    def validate_transport(self):
        if bool(self.bind_dn) != bool(self.bind_password):
            raise ValueError("LDAP provider bind_dn and bind_password must be configured together")
        parsed = urlparse(self.url)
        if parsed.scheme == "ldaps" and self.start_tls:
            raise ValueError("LDAP provider start_tls cannot be used with ldaps:// URLs")
        if parsed.scheme == "ldap" and not self.start_tls and not self.allow_insecure:
            raise ValueError("LDAP provider requires LDAPS or START_TLS unless allow_insecure=true")
        return self


AppEnvironment = Literal["development", "test", "production"]

ENV_FILE_PATH = Path(__file__).resolve().parents[2] / ".env"
DEFAULT_SQLITE_DB_PATH = ENV_FILE_PATH.parent / "app.db"
MIN_SECRET_LENGTH = 32
DEFAULT_INSECURE_SECRET_VALUES = {
    "",
    "change-me",
    "changeme",
    "default",
    "password",
    "secret",
}
def _default_sqlite_database_url() -> str:
    return f"sqlite:///{DEFAULT_SQLITE_DB_PATH.resolve().as_posix()}"


def _normalize_sqlite_database_url(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return text
    for prefix in ("sqlite:///", "sqlite+pysqlite:///"):
        if not text.startswith(prefix):
            continue
        remainder = text[len(prefix) :]
        if not remainder or remainder.startswith(":memory:") or remainder.startswith("/") or remainder.startswith("file:"):
            return text
        path_part, separator, suffix = remainder.partition("?")
        resolved = (ENV_FILE_PATH.parent / Path(path_part)).resolve()
        normalized = f"{prefix}{resolved.as_posix()}"
        return f"{normalized}?{suffix}" if separator else normalized
    return text

class Settings(BaseSettings):
    model_config = ConfigDict(
        env_file=ENV_FILE_PATH,
        env_nested_delimiter="__",
        extra="ignore",
    )

    app_name: str = Field("BucketReef", description="Application name")
    app_env: AppEnvironment = Field("development", description="Runtime security profile")
    onboarding_source: Literal["standard", "quickstart"] = Field(
        "standard", description="Informational onboarding hint; never changes security or feature defaults"
    )
    api_v1_prefix: str = "/api"
    jwt_keys: list[str] = Field(
        default_factory=lambda: ["change-me"],
        description="JWT key ring (JSON list)",
    )
    credential_keys: list[str] = Field(
        default_factory=lambda: ["change-me"],
        description="Credential key ring (JSON list)",
    )
    ui_jwt_keys: list[str] = Field(default_factory=list, description="Dedicated UI JWT key ring")
    api_jwt_keys: list[str] = Field(default_factory=list, description="Dedicated API JWT key ring")
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_issuer: str = "bucketreef"
    ui_jwt_audience: str = "bucketreef-ui"
    api_jwt_audience: str = "bucketreef-api"
    pre_auth_jwt_audience: str = "bucketreef-pre-auth"
    access_token_expire_minutes: int = Field(5, ge=1, le=15)
    refresh_token_expire_minutes: int = Field(60 * 24 * 7, description="Absolute refresh lifetime (minutes)")
    ui_session_idle_minutes: int = Field(60 * 12, ge=5)
    ui_session_absolute_minutes: int = Field(60 * 24 * 7, ge=5)
    s3_session_idle_minutes: int = Field(30, ge=5)
    s3_session_absolute_minutes: int = Field(60 * 8, ge=5)
    pre_auth_expire_minutes: int = Field(5, ge=1, le=10)
    mfa_recent_minutes: int = Field(15, ge=1, le=60)
    log_level: str = Field("INFO", description="Root log level")
    login_rate_limit_window_seconds: int = Field(
        300,
        ge=1,
        description="Sliding window for login failure rate limiting (seconds)",
    )
    login_rate_limit_max_attempts: int = Field(
        10,
        ge=1,
        description="Maximum failed login attempts allowed in rate-limit window",
    )
    api_token_default_expire_days: int = Field(
        30,
        description="Default API token expiry (days)",
    )
    api_token_max_expire_days: int = Field(
        90,
        description="Maximum API token expiry (days)",
    )
    refresh_token_cookie_name: str = Field("refresh_token", description="Cookie name for refresh token")
    access_token_cookie_name: str = Field("ui_access", description="Cookie name for UI access token")
    csrf_cookie_name: str = Field("csrf_token", description="Readable CSRF cookie name")
    pre_auth_cookie_name: str = Field("pre_auth", description="Cookie name for pre-authentication")
    refresh_token_cookie_path: str = Field("/api/auth", description="Cookie path for refresh token")
    refresh_token_cookie_domain: Optional[str] = Field(None, description="Cookie domain for refresh token")
    refresh_token_cookie_secure: bool = Field(False, description="Secure flag for refresh cookie")
    refresh_token_cookie_samesite: str = Field("lax", description="SameSite policy for refresh cookie")
    public_origin: str = Field("http://localhost:5173", description="Canonical browser origin")
    public_origins: list[str] = Field(
        default_factory=list,
        description="Additional trusted browser origins sharing the deployment boundary",
    )
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1", "testserver"])
    trusted_proxy_cidrs: list[str] = Field(default_factory=list)
    user_supplied_s3_endpoint_allowed_hosts: list[str] = Field(
        default_factory=list,
        description=(
            "Production allow-list for user-supplied S3 endpoint hosts; subdomains require an explicit wildcard "
            "(USER_SUPPLIED_S3_ENDPOINT_ALLOWED_HOSTS)"
        ),
    )
    require_registered_s3_login_endpoints: bool = False
    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "BucketReef"
    webauthn_origin: str = "http://localhost:5173"
    webauthn_origins: list[str] = Field(
        default_factory=list,
        description="Additional WebAuthn origins accepted for the shared RP ID",
    )
    content_security_policy: str = (
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
        "connect-src 'self'"
    )

    database_url: str = Field(
        _default_sqlite_database_url(),
        description="Database connection string (default sqlite)",
    )
    app_settings_path: Optional[str] = Field(
        None,
        description="Path to app_settings.json (defaults to backend/app/data/app_settings.json)",
    )

    seed_s3_endpoint: str = Field(
        "http://localhost:9000",
        description="Seed RGW/S3 endpoint",
    )
    seed_s3_endpoint_features: Optional[str] = Field(
        None,
        description="Seed default endpoint features (YAML or JSON)",
    )
    env_storage_endpoints: Optional[str] = Field(
        None,
        description="JSON array of storage endpoints managed by environment",
    )
    seed_s3_access_key: str = Field(
        "minio",
        description="Seed access key for RGW/S3",
    )
    seed_s3_secret_key: str = Field(
        "minio123",
        description="Seed secret key for RGW/S3",
    )
    seed_s3_region: str = Field(
        "us-east-1",
        description="Seed default S3 region",
    )
    storage_interactive_connect_timeout_seconds: float = Field(
        2.0,
        gt=0,
        description="Connection timeout for interactive S3-compatible API calls",
    )
    storage_interactive_read_timeout_seconds: float = Field(
        5.0,
        gt=0,
        description="Socket read timeout for interactive S3-compatible API calls",
    )
    storage_interactive_max_attempts: int = Field(
        2,
        ge=1,
        le=5,
        description="Maximum attempts for interactive S3-compatible API calls",
    )
    storage_long_running_read_timeout_seconds: float = Field(
        60.0,
        gt=0,
        description="Socket read timeout for long-running S3-compatible API calls",
    )

    seed_rgw_admin_access_key: Optional[str] = Field(
        None,
        description="Seed admin ops access key (defaults to seed_s3_access_key)",
    )
    seed_rgw_admin_secret_key: Optional[str] = Field(
        None,
        description="Seed admin ops secret key (defaults to seed_s3_secret_key)",
    )
    rgw_admin_timeout_seconds: float = Field(
        10.0,
        gt=0,
        description="HTTP timeout for RGW Admin Ops requests in seconds (RGW_ADMIN_TIMEOUT_SECONDS)",
    )
    rgw_admin_probe_timeout_seconds: float = Field(
        3.0,
        gt=0,
        description="HTTP timeout for explicit RGW Admin availability probes",
    )
    rgw_admin_bucket_list_stats_timeout_seconds: float = Field(
        120.0,
        gt=0,
        description=(
            "HTTP timeout for RGW Admin Ops bucket listing with stats in seconds "
            "(RGW_ADMIN_BUCKET_LIST_STATS_TIMEOUT_SECONDS)"
        ),
    )
    seed_supervision_access_key: Optional[str] = Field(
        None,
        description="Seed access key dedicated to supervision usage stats",
    )
    seed_supervision_secret_key: Optional[str] = Field(
        None,
        description="Seed secret key dedicated to supervision usage stats",
    )
    seed_ceph_admin_access_key: Optional[str] = Field(
        None,
        description="Seed access key dedicated to Ceph Admin advanced operations",
    )
    seed_ceph_admin_secret_key: Optional[str] = Field(
        None,
        description="Seed secret key dedicated to Ceph Admin advanced operations",
    )

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    oidc_providers: dict[str, OIDCProviderSettings] = Field(default_factory=dict)
    oidc_state_ttl_seconds: int = Field(600, description="Validity of OIDC login state (seconds)")
    ldap_providers: dict[str, LDAPProviderSettings] = Field(default_factory=dict)
    scheduled_jobs_enabled: bool = Field(
        True,
        description="Mount internal scheduled-job endpoints on this backend instance",
    )
    deployment_profile: DeploymentProfile = Field(
        "full",
        description="Deployment profile for this backend runtime (DEPLOYMENT_PROFILE)",
    )
    ceph_admin_high_security_mode: bool = Field(
        False,
        description="Run this backend as a dedicated Ceph Admin high-security instance",
    )

    feature_admin_enabled: Optional[bool] = Field(
        None,
        description="Force Admin surface on/off (FEATURE_ADMIN_ENABLED)",
    )
    feature_manager_enabled: Optional[bool] = Field(
        None,
        description="Force Manager feature on/off (FEATURE_MANAGER_ENABLED)",
    )
    feature_browser_enabled: Optional[bool] = Field(
        None,
        description="Force Browser feature on/off (FEATURE_BROWSER_ENABLED)",
    )
    feature_portal_enabled: Optional[bool] = Field(
        None,
        description="Force Portal feature on/off (FEATURE_PORTAL_ENABLED)",
    )
    feature_ceph_admin_enabled: Optional[bool] = Field(
        None,
        description="Force Ceph Admin feature on/off (FEATURE_CEPH_ADMIN_ENABLED)",
    )
    feature_storage_ops_enabled: Optional[bool] = Field(
        None,
        description="Force Storage Ops feature on/off (FEATURE_STORAGE_OPS_ENABLED)",
    )
    feature_billing_enabled: Optional[bool] = Field(
        None,
        description="Force Billing feature on/off (FEATURE_BILLING_ENABLED)",
    )
    feature_endpoint_status_enabled: Optional[bool] = Field(
        None,
        description="Force Endpoint Status feature on/off (FEATURE_ENDPOINT_STATUS_ENABLED)",
    )
    billing_store_by_bucket: bool = Field(
        False,
        description="Store per-bucket breakdown in billing snapshots",
    )
    internal_cron_token: Optional[str] = Field(
        None,
        description="Shared secret for internal cron endpoints (INTERNAL_CRON_TOKEN)",
    )
    backend_replicas: int = Field(
        1,
        ge=1,
        description="Expected number of backend replicas for startup safety warnings (BACKEND_REPLICAS)",
    )
    operation_lease_ttl_seconds: int = Field(
        1800,
        ge=15,
        description="Default backend operation lease TTL in seconds (OPERATION_LEASE_TTL_SECONDS)",
    )
    billing_operation_lease_ttl_seconds: int = Field(
        7200,
        ge=60,
        description="Billing collection operation lease TTL in seconds (BILLING_OPERATION_LEASE_TTL_SECONDS)",
    )
    billing_default_rate_card_name: Optional[str] = Field(
        None,
        description="Default billing rate card name when no explicit assignment exists",
    )
    billing_daily_retention_days: int = Field(
        365,
        ge=0,
        description="Retention in days for billing daily tables; 0 disables purge (BILLING_DAILY_RETENTION_DAYS)",
    )
    quota_history_hourly_retention_days: int = Field(
        30,
        ge=0,
        description="Retention in days for quota_usage_hourly; 0 disables purge (QUOTA_HISTORY_HOURLY_RETENTION_DAYS)",
    )
    quota_history_daily_retention_days: int = Field(
        365,
        ge=0,
        description="Retention in days for quota_usage_daily; 0 disables purge (QUOTA_HISTORY_DAILY_RETENTION_DAYS)",
    )
    user_notifications_retention_days: int = Field(
        90,
        ge=0,
        description="Retention in days for user notifications; 0 disables purge (USER_NOTIFICATIONS_RETENTION_DAYS)",
    )
    smtp_password: Optional[str] = Field(
        None,
        description="SMTP password used for quota notifications (SMTP_PASSWORD)",
    )

    healthcheck_timeout_seconds: int = Field(
        5,
        description="HTTP timeout for endpoint healthchecks in seconds (HEALTHCHECK_TIMEOUT_SECONDS)",
    )
    healthcheck_interval_seconds: int = Field(
        300,
        description="Expected healthcheck interval in seconds (HEALTHCHECK_INTERVAL_SECONDS)",
    )
    healthcheck_retention_days: int = Field(
        30,
        description="Retention for raw healthcheck rows in days (HEALTHCHECK_RETENTION_DAYS)",
    )
    healthcheck_degraded_latency_ms: int = Field(
        2000,
        description="Latency threshold (ms) for degraded status, 0 disables (HEALTHCHECK_DEGRADED_LATENCY_MS)",
    )
    healthcheck_verify_ssl: bool = Field(
        True,
        description="Verify TLS certificates for healthchecks (HEALTHCHECK_VERIFY_SSL)",
    )
    healthcheck_latency_baseline_window_days: int = Field(
        7,
        description="Window (days) used to compute latency baseline per endpoint/mode (HEALTHCHECK_LATENCY_BASELINE_WINDOW_DAYS)",
    )
    healthcheck_baseline_sample_size: int = Field(
        80,
        description="Maximum number of recent UP checks used for latency baseline (HEALTHCHECK_BASELINE_SAMPLE_SIZE)",
    )
    healthcheck_relative_degraded_ratio: float = Field(
        1.8,
        description="Relative ratio over baseline latency that marks a check degraded (HEALTHCHECK_RELATIVE_DEGRADED_RATIO)",
    )
    healthcheck_relative_degraded_min_delta_ms: int = Field(
        200,
        description="Minimum absolute latency delta over baseline to mark degraded (HEALTHCHECK_RELATIVE_DEGRADED_MIN_DELTA_MS)",
    )
    healthcheck_incident_recent_minutes: int = Field(
        720,
        description="Minutes window to highlight recently ended incidents (HEALTHCHECK_INCIDENT_RECENT_MINUTES)",
    )
    bucket_migration_worker_enabled: bool = Field(
        True,
        description="Enable background bucket migration worker (BUCKET_MIGRATION_WORKER_ENABLED)",
    )
    bucket_migration_poll_interval_seconds: float = Field(
        2.0,
        description="Polling interval for bucket migration worker (BUCKET_MIGRATION_POLL_INTERVAL_SECONDS)",
    )
    bucket_migration_parallelism_max: int = Field(
        16,
        description="Global maximum parallel copy/delete workers for bucket migration (BUCKET_MIGRATION_PARALLELISM_MAX)",
    )
    bucket_migration_max_active_per_endpoint: int = Field(
        2,
        description=(
            "Maximum number of concurrently claimed bucket migrations that can use the same source or target endpoint "
            "(BUCKET_MIGRATION_MAX_ACTIVE_PER_ENDPOINT)"
        ),
    )
    bucket_migration_worker_lease_seconds: int = Field(
        120,
        description="Duration of worker lease on a migration before takeover is allowed (BUCKET_MIGRATION_WORKER_LEASE_SECONDS)",
    )
    webhook_worker_enabled: bool = Field(
        True,
        description="Enable durable webhook delivery worker (WEBHOOK_WORKER_ENABLED)",
    )
    webhook_poll_interval_seconds: float = Field(
        1.0,
        gt=0,
        description="Polling interval for durable webhook deliveries (WEBHOOK_POLL_INTERVAL_SECONDS)",
    )
    webhook_worker_lease_seconds: int = Field(
        120,
        ge=15,
        description="Global webhook dispatcher lease duration (WEBHOOK_WORKER_LEASE_SECONDS)",
    )
    webhook_timeout_seconds: float = Field(
        5.0,
        gt=0,
        description="HTTP timeout for webhook deliveries (WEBHOOK_TIMEOUT_SECONDS)",
    )
    webhook_allow_private_targets: bool = Field(
        False,
        description="Allow webhook targets on private/local networks (WEBHOOK_ALLOW_PRIVATE_TARGETS)",
    )
    webhook_allowed_hosts: list[str] = Field(
        default_factory=list,
        description="Production allow-list for webhook target hosts (WEBHOOK_ALLOWED_HOSTS)",
    )
    webhook_workers: int = Field(
        4,
        ge=1,
        le=16,
        description="Maximum parallel webhook deliveries (WEBHOOK_WORKERS)",
    )
    webhook_max_attempts: int = Field(
        8,
        ge=1,
        le=32,
        description="Maximum webhook delivery attempts (WEBHOOK_MAX_ATTEMPTS)",
    )
    webhook_retry_initial_seconds: int = Field(
        30,
        ge=1,
        description="Initial webhook retry delay (WEBHOOK_RETRY_INITIAL_SECONDS)",
    )
    webhook_retry_max_seconds: int = Field(
        3600,
        ge=1,
        description="Maximum webhook retry delay (WEBHOOK_RETRY_MAX_SECONDS)",
    )
    webhook_retention_days: int = Field(
        30,
        ge=0,
        description="Retention for terminal webhook deliveries; 0 disables purge (WEBHOOK_RETENTION_DAYS)",
    )

    # Deprecated aliases retained for one upgrade window. New WEBHOOK_* values
    # take precedence when both are explicitly configured.
    bucket_migration_webhook_timeout_seconds: float = Field(
        2.0,
        gt=0,
        description="HTTP timeout for bucket migration webhooks (BUCKET_MIGRATION_WEBHOOK_TIMEOUT_SECONDS)",
    )
    bucket_migration_webhook_allow_private_targets: bool = Field(
        False,
        description=(
            "Allow bucket migration webhooks to target private/local network addresses "
            "(BUCKET_MIGRATION_WEBHOOK_ALLOW_PRIVATE_TARGETS)"
        ),
    )
    bucket_migration_webhook_allowed_hosts: list[str] = Field(
        default_factory=list,
        description=(
            "Optional allow-list for bucket migration webhook hosts (JSON list or comma-separated, "
            "BUCKET_MIGRATION_WEBHOOK_ALLOWED_HOSTS)"
        ),
    )
    bucket_migration_webhook_queue_size: int = Field(
        500,
        ge=1,
        le=10000,
        description=(
            "Deprecated compatibility setting; ignored because webhook deliveries now use a durable database queue "
            "(BUCKET_MIGRATION_WEBHOOK_QUEUE_SIZE)"
        ),
    )
    bucket_migration_webhook_workers: int = Field(
        1,
        ge=1,
        le=8,
        description="Number of background webhook workers for bucket migration events (BUCKET_MIGRATION_WEBHOOK_WORKERS)",
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value):
        return _normalize_sqlite_database_url(value)

    @field_validator(
        "webhook_allowed_hosts",
        "bucket_migration_webhook_allowed_hosts",
        "user_supplied_s3_endpoint_allowed_hosts",
        mode="before",
    )
    @classmethod
    def parse_outbound_host_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError("Unable to parse outbound allowed hosts JSON") from exc
                if not isinstance(parsed, list):
                    raise ValueError("Outbound allowed hosts must be a list")
                return [str(item).strip().lower() for item in parsed if str(item).strip()]
            return [item.strip().lower() for item in text.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item).strip().lower() for item in value if str(item).strip()]
        return value

    @field_validator("ldap_providers")
    @classmethod
    def normalize_ldap_provider_ids(cls, value):
        normalized = {}
        for key, provider in (value or {}).items():
            provider_id = str(key or "").strip().lower()
            if not provider_id or not LDAP_PROVIDER_ID_PATTERN.fullmatch(provider_id):
                raise ValueError("LDAP provider keys must match [a-z0-9_-]+")
            if provider_id in normalized:
                raise ValueError(f"Duplicate LDAP provider key after normalization: {provider_id}")
            normalized[provider_id] = provider
        return normalized

    @field_validator("log_level", mode="before")
    @classmethod
    def normalize_log_level(cls, value):
        text = str(value or "INFO").strip().upper()
        allowed = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
        if text not in allowed:
            raise ValueError(f"log_level must be one of: {', '.join(sorted(allowed))}")
        return text

    @model_validator(mode="after")
    def validate_settings(self):
        if not self.jwt_keys:
            raise ValueError("jwt_keys must contain at least one key")
        if not self.credential_keys:
            raise ValueError("credential_keys must contain at least one key")
        if self.api_token_default_expire_days < 1:
            raise ValueError("api_token_default_expire_days must be >= 1")
        if self.api_token_max_expire_days < 1:
            raise ValueError("api_token_max_expire_days must be >= 1")
        if self.api_token_default_expire_days > self.api_token_max_expire_days:
            raise ValueError("api_token_default_expire_days must be <= api_token_max_expire_days")
        if self.ui_session_idle_minutes > self.ui_session_absolute_minutes:
            raise ValueError("ui_session_idle_minutes must be <= ui_session_absolute_minutes")
        if self.s3_session_idle_minutes > self.s3_session_absolute_minutes:
            raise ValueError("s3_session_idle_minutes must be <= s3_session_absolute_minutes")
        for value in self.trusted_proxy_cidrs:
            try:
                ipaddress.ip_network(value, strict=False)
            except ValueError as exc:
                raise ValueError(f"Invalid trusted proxy CIDR: {value}") from exc
        return self

    def effective_ui_jwt_keys(self) -> list[str]:
        return list(self.ui_jwt_keys or self.jwt_keys)

    def effective_api_jwt_keys(self) -> list[str]:
        return list(self.api_jwt_keys or self.jwt_keys)

    def effective_public_origins(self) -> list[str]:
        return _deduplicate_origins([self.public_origin, *self.public_origins])

    def effective_webauthn_origins(self) -> list[str]:
        return _deduplicate_origins([self.webauthn_origin, *self.webauthn_origins])

def is_weak_secret_value(value: Optional[str]) -> bool:
    if value is None:
        return True
    normalized = str(value).strip()
    if normalized.lower() in DEFAULT_INSECURE_SECRET_VALUES:
        return True
    return len(normalized) < MIN_SECRET_LENGTH


def _deduplicate_origins(origins: list[str]) -> list[str]:
    normalized: list[str] = []
    for raw_origin in origins:
        origin = str(raw_origin or "").strip().rstrip("/")
        if origin and origin not in normalized:
            normalized.append(origin)
    return normalized


def is_local_origin(origin: str) -> bool:
    text = str(origin or "").strip()
    if not text:
        return True
    if text == "*":
        return False
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    return host in {"localhost", "127.0.0.1", "::1"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
