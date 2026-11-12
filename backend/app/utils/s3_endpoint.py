# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

from app.core.config import get_settings
from app.utils.network_targets import validate_outbound_url

settings = get_settings()


def normalize_s3_endpoint(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def _validated_https_s3_components(
    normalized: str,
    *,
    field_name: str,
) -> tuple[str, str, int | None, str]:
    parsed = urlsplit(normalized)
    scheme = (parsed.scheme or "").lower()
    if scheme != "https":
        raise ValueError(f"{field_name} must use https")
    if parsed.query or parsed.fragment:
        raise ValueError(f"{field_name} must not include query parameters or fragments")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name} must not include credentials")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError(f"{field_name} must include a hostname")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{field_name} has an invalid port") from exc
    return scheme, hostname.lower(), port, parsed.path or ""


def _s3_endpoint_netloc(hostname: str, port: int | None) -> str:
    host = hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"{host}:{port}" if port is not None else host


def _canonical_https_s3_endpoint(normalized: str, *, field_name: str) -> str:
    scheme, hostname, port, path = _validated_https_s3_components(
        normalized,
        field_name=field_name,
    )
    cleaned = urlunsplit(
        (scheme, _s3_endpoint_netloc(hostname, port), path, "", "")
    ).rstrip("/")
    if not cleaned:
        raise ValueError(f"{field_name} is invalid")
    return cleaned


def _user_supplied_s3_allowed_hosts() -> set[str] | None:
    if settings.app_env != "production":
        return None
    return set(settings.user_supplied_s3_endpoint_allowed_hosts)


def validate_user_supplied_s3_endpoint(value: str, *, field_name: str = "Endpoint URL") -> str:
    normalized = normalize_s3_endpoint(value)
    if not normalized:
        raise ValueError(f"{field_name} is required")
    cleaned = _canonical_https_s3_endpoint(normalized, field_name=field_name)
    validate_outbound_url(
        cleaned,
        field_name=field_name,
        allowed_schemes=("https",),
        scheme_label="https",
        allowed_hosts=_user_supplied_s3_allowed_hosts(),
    )
    return cleaned


def validate_custom_login_s3_endpoint(value: str) -> str:
    return validate_user_supplied_s3_endpoint(value, field_name="Custom endpoint URL")


def validate_openstack_catalog_s3_endpoint(
    value: str,
    *,
    field_name: str = "OpenStack S3 endpoint URL",
) -> str:
    """Validate an S3 target supplied by an administrator-configured Keystone catalog."""
    normalized = normalize_s3_endpoint(value)
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return _canonical_https_s3_endpoint(normalized, field_name=field_name)


def configured_s3_endpoint() -> Optional[str]:
    if "seed_s3_endpoint" not in settings.model_fields_set:
        return None
    return normalize_s3_endpoint(settings.seed_s3_endpoint)
