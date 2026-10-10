# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional, TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

from app.core.config import get_settings
from app.db import S3Account, S3User
from app.utils.network_targets import validate_outbound_url

if TYPE_CHECKING:
    from app.services.s3_execution_context import S3ExecutionContext

settings = get_settings()


def normalize_s3_endpoint(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def validate_user_supplied_s3_endpoint(value: str, *, field_name: str = "Endpoint URL") -> str:
    normalized = normalize_s3_endpoint(value)
    if not normalized:
        raise ValueError(f"{field_name} is required")
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
    host = hostname.lower()
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    netloc = f"{host}:{port}" if port is not None else host
    cleaned = urlunsplit((scheme, netloc, parsed.path or "", "", "")).rstrip("/")
    if not cleaned:
        raise ValueError(f"{field_name} is invalid")
    validate_outbound_url(
        cleaned,
        field_name=field_name,
        allowed_schemes=("https",),
        scheme_label="https",
        allowed_hosts=(
            set(settings.user_supplied_s3_endpoint_allowed_hosts)
            if settings.app_env == "production"
            else None
        ),
    )
    return cleaned


def validate_custom_login_s3_endpoint(value: str) -> str:
    return validate_user_supplied_s3_endpoint(value, field_name="Custom endpoint URL")


def configured_s3_endpoint() -> Optional[str]:
    if "seed_s3_endpoint" not in settings.model_fields_set:
        return None
    return normalize_s3_endpoint(settings.seed_s3_endpoint)


def resolve_s3_endpoint(account: "S3Account | S3User | S3ExecutionContext") -> Optional[str]:
    if not isinstance(account, (S3Account, S3User)) and account.session_endpoint:
        return account.session_endpoint
    endpoint = account.storage_endpoint
    if endpoint is not None and endpoint.endpoint_url:
        return endpoint.endpoint_url
    return None


def resolve_s3_client_options(
    account: "S3Account | S3User | S3ExecutionContext",
) -> tuple[Optional[str], Optional[str], bool, bool]:
    """Resolve S3 client options (endpoint, region, force_path_style, verify_tls)."""
    endpoint = resolve_s3_endpoint(account)
    endpoint_obj = account.storage_endpoint
    if isinstance(account, (S3Account, S3User)):
        region = None
        session_force_path_style = None
        session_verify_tls = None
    else:
        region = account.session_region
        session_force_path_style = account.session_force_path_style
        session_verify_tls = account.session_verify_tls
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


def resolve_s3_client_kwargs(account: "S3Account | S3User | S3ExecutionContext") -> dict[str, object]:
    endpoint, region, force_path_style, verify_tls = resolve_s3_client_options(account)
    return {
        "endpoint": endpoint,
        "region": region,
        "force_path_style": force_path_style,
        "verify_tls": verify_tls,
    }


def resolve_iam_client_options(account: "S3Account | S3ExecutionContext") -> tuple[Optional[str], Optional[str], bool]:
    """Resolve IAM client options for account-like manager contexts."""
    from app.utils.s3_connection_endpoint import resolve_connection_details
    from app.utils.storage_endpoint_features import (
        aws_iam_client_options_for_region,
        resolve_iam_endpoint,
        resolve_iam_signing_region,
    )

    endpoint_obj = account.storage_endpoint
    region: Optional[str] = None if isinstance(account, S3Account) else account.session_region
    verify_tls = True
    if endpoint_obj is not None:
        endpoint = resolve_iam_endpoint(endpoint_obj)
        if endpoint_obj.provider == "aws":
            region = resolve_iam_signing_region(endpoint_obj)
        elif region is None:
            region = resolve_iam_signing_region(endpoint_obj)
        verify_tls = bool(endpoint_obj.verify_tls)
        return endpoint, region, verify_tls

    source_connection = None if isinstance(account, S3Account) else account.source_connection
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
