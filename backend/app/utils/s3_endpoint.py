# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, Protocol, cast
from urllib.parse import urlsplit, urlunsplit

from app.core.config import get_settings
from app.utils.network_targets import validate_outbound_url
from app.utils.storage_endpoint_features import StorageEndpointLike


class S3EndpointTarget(Protocol):
    storage_endpoint: Optional[StorageEndpointLike]

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


def resolve_s3_endpoint(account: S3EndpointTarget) -> Optional[str]:
    session_endpoint = cast(
        Optional[str],
        getattr(account, "session_endpoint", None),
    )
    if session_endpoint:
        return session_endpoint
    endpoint = account.storage_endpoint
    if endpoint is not None and endpoint.endpoint_url:
        return endpoint.endpoint_url
    return None


def resolve_s3_client_options(
    account: S3EndpointTarget,
) -> tuple[Optional[str], Optional[str], bool, bool]:
    """Resolve S3 client options (endpoint, region, force_path_style, verify_tls)."""
    endpoint = resolve_s3_endpoint(account)
    endpoint_obj = account.storage_endpoint
    region = cast(Optional[str], getattr(account, "session_region", None))
    session_force_path_style = cast(
        Optional[bool],
        getattr(account, "session_force_path_style", None),
    )
    session_verify_tls = cast(
        Optional[bool],
        getattr(account, "session_verify_tls", None),
    )
    if region is None:
        region = endpoint_obj.region if endpoint_obj is not None else None
    if session_force_path_style is not None:
        force_path_style = bool(session_force_path_style)
    elif endpoint_obj is not None:
        force_path_style = bool(endpoint_obj.force_path_style)
    else:
        force_path_style = False
    if session_verify_tls is not None:
        verify_tls = bool(session_verify_tls)
    elif endpoint_obj is not None:
        verify_tls = bool(endpoint_obj.verify_tls)
    else:
        verify_tls = True
    return endpoint, region, force_path_style, verify_tls


def resolve_s3_client_kwargs(account: S3EndpointTarget) -> dict[str, object]:
    endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
    return {
        "endpoint": endpoint,
        "region": region,
        "force_path_style": force_path_style,
        "verify_tls": verify_tls,
    }


def resolve_iam_client_options(account: S3EndpointTarget) -> tuple[Optional[str], Optional[str], bool]:
    """Resolve IAM client options for account-like manager contexts."""
    from app.utils.s3_connection_endpoint import resolve_connection_details
    from app.utils.storage_endpoint_features import (
        aws_iam_client_options_for_region,
        resolve_iam_endpoint,
        resolve_iam_signing_region,
    )

    endpoint_obj = account.storage_endpoint
    region = cast(Optional[str], getattr(account, "session_region", None))
    verify_tls = True
    if endpoint_obj is not None:
        endpoint = resolve_iam_endpoint(endpoint_obj)
        if endpoint_obj.provider == "aws":
            region = resolve_iam_signing_region(endpoint_obj)
        elif region is None:
            region = resolve_iam_signing_region(endpoint_obj)
        verify_tls = bool(endpoint_obj.verify_tls)
        return endpoint, region, verify_tls

    source_connection = getattr(account, "source_connection", None)
    if source_connection is not None:
        details = resolve_connection_details(source_connection)
        provider = (details.provider or "").strip().lower()
        if provider == "aws":
            endpoint, iam_region = aws_iam_client_options_for_region(details.region)
        else:
            endpoint = details.endpoint_url
            iam_region = details.region
        return endpoint, iam_region, details.verify_tls

    endpoint, region, _, verify_tls = resolve_s3_client_options(account)
    return endpoint, region, verify_tls
