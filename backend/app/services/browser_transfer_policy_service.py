# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Serialize browser network destinations; never accept CSP text from a client."""
import hashlib
import ipaddress
import json
import re
from urllib.parse import urlsplit

from app.models.browser_transfer_policy import BrowserTransferPolicy, BrowserTransferWorkspace
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.s3_endpoint import resolve_s3_client_options


def s3_connect_sources(endpoint: str, *, force_path_style: bool) -> list[str]:
    if not endpoint or any(ord(char) <= 32 or ord(char) >= 127 for char in endpoint):
        raise ValueError("Invalid S3 endpoint for direct transfers")
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"https", "http"} or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Invalid S3 endpoint for direct transfers")
    host = (parsed.hostname or "").lower()
    port = parsed.port
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and address.version == 6:
        raise ValueError("Direct transfers require a DNS hostname instead of a literal IPv6 address")
    if not host or len(host) > 253 or not all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in host.rstrip(".").split(".")
    ):
        raise ValueError("Invalid S3 endpoint hostname for direct transfers")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("Invalid S3 endpoint port for direct transfers")
    suffix = f":{port}" if port is not None else ""
    sources = [f"{parsed.scheme}://{host}{suffix}"]
    if not force_path_style and address is None:
        sources.append(f"{parsed.scheme}://*.{host}{suffix}")
    return sources


def build_transfer_policy(
    context: S3ExecutionContext, *, workspace: BrowserTransferWorkspace, context_id: str | None,
) -> BrowserTransferPolicy:
    endpoint, _, force_path_style, _ = resolve_s3_client_options(context)
    sources = s3_connect_sources(endpoint or "", force_path_style=force_path_style)
    payload = json.dumps([workspace, context_id, sources], separators=(",", ":"), ensure_ascii=True)
    return BrowserTransferPolicy(
        workspace=workspace, context_id=context_id, connect_sources=sources,
        policy_id=hashlib.sha256(payload.encode()).hexdigest(),
    )


def worker_content_security_policy(policy: BrowserTransferPolicy) -> str:
    return "default-src 'none'; script-src 'self'; worker-src 'none'; connect-src " + " ".join(policy.connect_sources)
