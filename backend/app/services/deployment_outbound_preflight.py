# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import S3Connection, WebhookEndpoint
from app.services.webhook_service import webhook_dispatcher_enabled, webhook_runtime_config
from app.utils.network_targets import host_matches_allowlist
from app.utils.s3_connection_endpoint import parse_custom_endpoint_config


@dataclass(frozen=True, order=True)
class UncoveredTarget:
    target_type: str
    hostname: str


def _hostname(url: str) -> str:
    return str(urlparse(url).hostname or "").strip().lower().rstrip(".")


def find_uncovered_outbound_targets(db: Session, settings: Settings) -> list[UncoveredTarget]:
    uncovered: set[UncoveredTarget] = set()
    connections = (
        db.query(S3Connection)
        .filter(
            S3Connection.is_shared.is_(False),
            S3Connection.server_managed.is_(False),
            S3Connection.storage_endpoint_id.is_(None),
            S3Connection.custom_endpoint_config.is_not(None),
        )
        .all()
    )
    for connection in connections:
        try:
            hostname = _hostname(parse_custom_endpoint_config(connection.custom_endpoint_config).endpoint_url or "")
        except (TypeError, ValueError):
            hostname = "<invalid>"
        if not host_matches_allowlist(hostname, settings.user_supplied_s3_endpoint_allowed_hosts):
            uncovered.add(UncoveredTarget("user-s3-endpoint", hostname or "<invalid>"))

    if webhook_dispatcher_enabled(settings):
        webhook_hosts = webhook_runtime_config(settings).allowed_hosts
        for (webhook_url,) in db.query(WebhookEndpoint.url).all():
            hostname = _hostname(webhook_url or "") or "<invalid>"
            if not host_matches_allowlist(hostname, webhook_hosts):
                uncovered.add(UncoveredTarget("webhook", hostname))
    return sorted(uncovered)


def run_outbound_target_preflight(
    db: Session,
    settings: Settings,
    *,
    emit: Callable[[str], None] = print,
) -> int:
    targets = find_uncovered_outbound_targets(db, settings)
    for target in targets:
        emit(f"{target.target_type}: {target.hostname}")
    if targets:
        emit(f"Blocked outbound hostnames: {len(targets)}")
        return 1
    emit("All persisted outbound hostnames are covered by the configured allowlists.")
    return 0
