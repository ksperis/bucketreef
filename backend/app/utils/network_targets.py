# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ipaddress
import socket
from typing import Iterable, Optional
from urllib.parse import urlparse

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def resolve_hostname_ips(host: str) -> set[IPAddress]:
    normalized_host = str(host or "").strip().lower().rstrip(".")
    if not normalized_host:
        return set()

    resolved: set[IPAddress] = set()
    for _, _, _, _, sockaddr in socket.getaddrinfo(normalized_host, None):
        try:
            resolved.add(ipaddress.ip_address(sockaddr[0]))
        except Exception:  # noqa: BLE001
            continue
    return resolved


def is_private_or_local_ip(address: IPAddress) -> bool:
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or address.is_reserved
    )


def _normalized_allowed_schemes(allowed_schemes: Iterable[str]) -> set[str]:
    normalized = {
        str(scheme).strip().lower()
        for scheme in allowed_schemes
        if str(scheme).strip()
    }
    return normalized or {"https"}


def _validated_outbound_host(
    url: str,
    *,
    field_name: str,
    allowed_schemes: set[str],
    display_scheme: str,
) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in allowed_schemes or not parsed.netloc or not parsed.hostname:
        raise ValueError(f"{field_name} must be a valid {display_scheme} URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{field_name} must not include user credentials")
    return parsed.hostname.strip().lower().rstrip(".")


def _resolved_outbound_ips(host: str, *, field_name: str) -> set[IPAddress]:
    try:
        resolved_ips = resolve_hostname_ips(host)
    except socket.gaierror as exc:
        raise ValueError(f"{field_name} host cannot be resolved: {exc}") from exc
    if not resolved_ips:
        raise ValueError(f"{field_name} host cannot be resolved")
    return resolved_ips


def validate_outbound_url(
    url: str,
    *,
    field_name: str,
    allowed_schemes: Iterable[str] = ("https",),
    scheme_label: Optional[str] = None,
    allowed_hosts: Optional[set[str]] = None,
    allow_private_targets: bool = False,
    private_target_hint: Optional[str] = None,
) -> None:
    normalized_schemes = _normalized_allowed_schemes(allowed_schemes)
    display_scheme = scheme_label or "/".join(sorted(normalized_schemes))
    host = _validated_outbound_host(
        url,
        field_name=field_name,
        allowed_schemes=normalized_schemes,
        display_scheme=display_scheme,
    )
    if allowed_hosts is not None and not host_matches_allowlist(host, allowed_hosts):
        raise ValueError(f"{field_name} host is not allowed by policy")
    resolved_ips = _resolved_outbound_ips(host, field_name=field_name)
    if not allow_private_targets and any(is_private_or_local_ip(address) for address in resolved_ips):
        raise ValueError(f"{field_name} resolves to a private or local network address{private_target_hint or ''}")


def host_matches_allowlist(host: str, allowed_hosts: Iterable[str]) -> bool:
    """Match an exact hostname or an explicitly declared ``*.example.com`` wildcard."""
    normalized_host = str(host or "").strip().lower().rstrip(".")
    if not normalized_host:
        return False
    for allowed in allowed_hosts:
        normalized_allowed = str(allowed or "").strip().lower().rstrip(".")
        if not normalized_allowed:
            continue
        if normalized_allowed.startswith("*."):
            wildcard_suffix = normalized_allowed[2:]
            if wildcard_suffix and normalized_host.endswith(f".{wildcard_suffix}"):
                return True
            continue
        if normalized_host == normalized_allowed:
            return True
    return False
