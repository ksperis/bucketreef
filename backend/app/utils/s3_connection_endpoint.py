# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol, Tuple

from app.utils.storage_endpoint_features import StorageEndpointLike


class S3ConnectionLike(Protocol):
    storage_endpoint: Optional[StorageEndpointLike]
    custom_endpoint_url: Optional[str]
    custom_region: Optional[str]
    custom_force_path_style: Optional[bool]
    custom_verify_tls: Optional[bool]
    custom_provider: Optional[str]


@dataclass
class ConnectionEndpointDetails:
    endpoint_url: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    provider: Optional[str]
    endpoint_name: Optional[str]


def resolve_connection_details(conn: S3ConnectionLike) -> ConnectionEndpointDetails:
    endpoint = conn.storage_endpoint
    if endpoint is not None:
        return ConnectionEndpointDetails(
            endpoint.endpoint_url,
            endpoint.region,
            endpoint.force_path_style,
            endpoint.verify_tls,
            endpoint.provider,
            endpoint.name,
        )
    endpoint_url = conn.custom_endpoint_url
    if endpoint_url is None:
        raise ValueError("Manual S3 connection is missing its endpoint URL")
    force_path_style = conn.custom_force_path_style
    verify_tls = conn.custom_verify_tls
    if force_path_style is None or verify_tls is None:
        raise ValueError("Manual S3 connection endpoint flags are missing")
    return ConnectionEndpointDetails(
        endpoint_url,
        conn.custom_region,
        force_path_style,
        verify_tls,
        conn.custom_provider,
        None,
    )


def resolve_connection_endpoint(conn: S3ConnectionLike) -> Tuple[Optional[str], Optional[str], bool, bool]:
    details = resolve_connection_details(conn)
    return details.endpoint_url, details.region, details.force_path_style, details.verify_tls
